#!/usr/bin/env bash
# Switchback 的反向隧道：把本机的远程口送到中转服务器的回环上。
#
#   scripts/tunnel.sh install | uninstall     交给 launchd 常驻：开机自启、断了自己拉起
#   scripts/tunnel.sh start | stop | status   起、停、看（托管着时起停的是 launchd 那份）
#   scripts/tunnel.sh rotate                  换钥匙
#   scripts/tunnel.sh run                     前台跑一条（launchd 调的就是它）
#
# ## 为什么是 ssh -R 而不是自己写一个中继
#
# 中转那台机器上**一行代码都不用跑**。没有要维护的进程、没有要升级的依赖、
# 没有一个「中继自己有漏洞」的新面。ssh 这条路已经被审了三十年。
#
# ## 一条隧道顺带转别的口
#
# `SWITCHBACK_TUNNEL_EXTRA` 写几段 `远端口:本机地址:本机口`（空格分隔），和 Switchback 的口
# 走同一条 ssh。本机上别的远程服务（比如 remote-bash 的 `7681:<本机 Tailscale 地址>:7681`——
# 它只听 Tailscale 地址）不用再各开一条隧道、各配一把钥匙；中转服务器那头再给它挂一个
# `tailscale serve` 端口就行（见 `docs/远程访问设置.md`）。**这份清单是这台机器的事**，
# 写在 launchd 那份 plist 里（`install` 时照当前环境写进去），不写进仓库。
#
# ## 为什么要 launchd 守着
#
# 手动 `start` 起的那条，Mac 睡一觉、换一次网就断了，而且**没有任何东西把它拉起来**——
# 人在外面打开手机才发现。`install` 之后断了 15 秒内重起（`ThrottleInterval`）。
# 服务器那头要配一条 `ClientAliveInterval`（见 `docs/远程访问设置.md` §5）：不配的话，
# 死掉的旧会话要等 TCP keepalive（两小时）才放开它占着的反向端口，
# 这期间新隧道会一直「remote port forwarding failed」。
#
# ## 这把钥匙能做什么
#
# 只有一件事：开上面那几个反向端口（`127.0.0.1:17800`，加上 `EXTRA` 里的远端口）。
#
# **`permitopen` 这一条是补上去的，原来漏了。** `restrict` 确实关掉了全部转发，
# 但紧跟着的 `port-forwarding` 又把**本地转发和反向转发一起**打开了，而 `permitlisten`
# 只管反向那一半。实测过：拿这把「受限」的钥匙跑
# `ssh -L 19998:127.0.0.1:22 <用户>@服务器`，当场读到了 sshd 的版本横幅——
# 也就是说它能把服务器当成任意 TCP 代理，包括内网和云厂商的元数据地址。
#
# **值是 `127.0.0.1:1` 而不是 `none`。** `none` 只在 sshd_config 的 `PermitOpen` 里有效；
# 写进 authorized_keys 的 `permitopen` 要求 `host:port`，`none` 解析不出端口，
# sshd 会把**整行判成无效**——表现是这把钥匙连认证都过不了（`Permission denied (publickey)`），
# 而不是「转发被拒」。这一条是实测踩出来的：写 `none` 之后隧道当场起不来。
# `127.0.0.1:1` 是个语法合法、实际上永远连不通的目标，效果等价于「本地转发全禁」。
set -euo pipefail

HOST="${SWITCHBACK_TUNNEL_HOST:-kr-omni}"
PORT="${SWITCHBACK_TUNNEL_PORT:-17800}"
LOCAL="${SWITCHBACK_TUNNEL_LOCAL:-17800}"
KEY="${SWITCHBACK_TUNNEL_KEY:-$HOME/.ssh/omni-tunnel}"
EXTRA="${SWITCHBACK_TUNNEL_EXTRA:-}"
# 认自己的进程用这个标记，不靠 pgrep 猜端口号——那会误伤别人的隧道
# `kr-omni`、`omni-tunnel` 这几个值**改名之后也不动**：它们是 ~/.ssh/config 里的主机别名、
# 钥匙文件名和正在跑的隧道命令行里的标记，改了就认不出已有的钥匙和进程
TAG="omni-tunnel-$PORT"
LABEL="dev.wzj.switchback.tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/switchback-tunnel.log"
DOMAIN="gui/$(id -u)"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# **变量后面紧跟全角字符时必须用 `${x}`。** 某些 locale 下 bash 会把
# `）` 的 UTF-8 字节当成变量名的一部分，于是 `$pid）` 变成一个叫
# `pid\xef\xbc\x89` 的变量——配上 `set -u` 就是「unbound variable」，
# 而报错信息里那个变量名看起来和你写的一模一样。
find_pid() {
  pgrep -f "$TAG" || true
}

bad() {
  echo "$1" >&2
  exit 2
}

# 端口和 `EXTRA` 都要先验：它们会被拼进 ssh 的参数，`rotate` 还会把它们拼进服务器上执行的那段 shell
check_config() {
  case "$PORT" in '' | *[!0-9]*) bad "端口不合法：$PORT" ;; esac
  case "$LOCAL" in '' | *[!0-9]*) bad "本机端口不合法：$LOCAL" ;; esac
  for spec in $EXTRA; do
    case "$spec" in *[!0-9A-Za-z.:-]*) bad "SWITCHBACK_TUNNEL_EXTRA 里有不认识的字符：$spec" ;; esac
    local remote="${spec%%:*}" rest="${spec#*:}"
    local host="${rest%%:*}" port="${rest#*:}"
    case "$remote" in '' | *[!0-9]*) bad "远端口不合法：$spec（要 远端口:本机地址:本机口）" ;; esac
    case "$port" in '' | *[!0-9]*) bad "本机口不合法：$spec（要 远端口:本机地址:本机口）" ;; esac
    [ -n "$host" ] && [ "$host" != "$rest" ] || bad "缺本机地址：$spec（要 远端口:本机地址:本机口）"
  done
}

# 全部 `-R`。服务器那头一律只绑回环：对外由 `tailscale serve` 接，不靠 GatewayPorts
forward_args() {
  printf -- '-R 127.0.0.1:%s:127.0.0.1:%s' "$PORT" "$LOCAL"
  for spec in $EXTRA; do printf -- ' -R 127.0.0.1:%s' "$spec"; done
}

# 受限钥匙那一行要列的全部 `permitlisten`
listens() {
  printf 'permitlisten="127.0.0.1:%s"' "$PORT"
  for spec in $EXTRA; do printf ',permitlisten="127.0.0.1:%s"' "${spec%%:*}"; done
}

describe() {
  printf '%s 的 127.0.0.1:%s → 本机 127.0.0.1:%s' "$HOST" "$PORT" "$LOCAL"
  for spec in $EXTRA; do printf '；127.0.0.1:%s → 本机 %s' "${spec%%:*}" "${spec#*:}"; done
}

managed() {
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1
}

stamp() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

# ExitOnForwardFailure：端口被占时**当场退出**，而不是留下一条通了 ssh
# 却没转发成的连接——那种连接看起来是好的，直到你在手机上打不开
ssh_tunnel() {
  # shellcheck disable=SC2046 # 参数已经在 check_config 里验过，只有端口、地址和冒号
  ssh -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o BatchMode=yes \
    -o "SetEnv=SWITCHBACK_TAG=$TAG" \
    "$@" \
    $(forward_args) \
    "$HOST"
}

xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

write_plist() {
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$SELF")</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SWITCHBACK_TUNNEL_HOST</key>
    <string>$(xml "$HOST")</string>
    <key>SWITCHBACK_TUNNEL_PORT</key>
    <string>$PORT</string>
    <key>SWITCHBACK_TUNNEL_LOCAL</key>
    <string>$LOCAL</string>
    <key>SWITCHBACK_TUNNEL_KEY</key>
    <string>$(xml "$KEY")</string>
    <key>SWITCHBACK_TUNNEL_EXTRA</key>
    <string>$(xml "$EXTRA")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
}

check_config

case "${1:-status}" in
run)
  # 日志自己滚：launchd 只管把输出接进同一个文件，不会替你截
  if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1048576 ]; then mv -f "$LOG" "$LOG.1"; fi
  echo "$(stamp) 起隧道：$(describe)"
  rc=0
  ssh_tunnel || rc=$?
  echo "$(stamp) 隧道退出 rc=${rc}（launchd 15 秒后重起）"
  exit "$rc"
  ;;
install)
  [ -r "$KEY" ] || bad "没有隧道钥匙 $KEY"
  write_plist
  # 手动起的那条先停：两条抢同一个远端口，launchd 这条会一直「remote port forwarding failed」
  if managed; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  pid="$(find_pid)"
  if [ -n "$pid" ]; then
    kill ${pid}
  fi
  sleep 2
  launchctl bootstrap "$DOMAIN" "$PLIST"
  sleep 3
  echo "已交给 launchd（$LABEL）：$(describe)"
  echo "日志：$LOG"
  "$SELF" status
  ;;
uninstall)
  if managed; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  rm -f "$PLIST"
  echo "已从 launchd 撤下，plist 已删。要手动起用 $0 start"
  ;;
start)
  if managed; then
    echo "已经交给 launchd 了（$LABEL），断了它会自己拉起；要重起用 launchctl kickstart -k $DOMAIN/$LABEL"
    exit 0
  fi
  if [ -f "$PLIST" ]; then
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "launchd 那份重新挂上了：$(describe)"
    exit 0
  fi
  if [ -n "$(find_pid)" ]; then
    echo "已经在跑了（pid $(find_pid) ）"
    exit 0
  fi
  ssh_tunnel -f
  sleep 1
  echo "隧道已起：$(describe)"
  ;;
stop)
  # 托管着的时候光 kill 没用：KeepAlive 会在 15 秒内把它拉回来
  if managed; then
    launchctl bootout "$DOMAIN/$LABEL"
    echo "已从 launchd 撤下（plist 还在，下次登录会自己起来；彻底停用用 $0 uninstall）"
    exit 0
  fi
  pid="$(find_pid)"
  if [ -z "$pid" ]; then
    echo "没在跑"
    exit 0
  fi
  kill ${pid}
  echo "已停（pid ${pid} ）"
  ;;
status)
  if managed; then echo "launchd：托管着（$LABEL）"; else echo "launchd：没托管"; fi
  pid="$(find_pid)"
  if [ -z "$pid" ]; then
    echo "隧道：没在跑"
  else
    echo "隧道：在跑（pid ${pid} ）"
  fi
  echo "转发：$(describe)"
  ;;
rotate)
  # 换钥匙。**顺序是「装上新的 → 验它真的能用 → 才删旧的」**，
  # 中间任何一步失败，旧钥匙都还在服务器上，隧道照样起得来。
  #
  # 原来这里是「先 grep -v 删掉旧行、再追加新行」——那一步里
  # 新旧同时不成立，而且没有任何东西验过新的那把能不能用。
  # 这是一次性的、动别人服务器的操作，失败的代价是「人在外面、门开不了」。
  tag="omni-tunnel-$(date +%Y%m%d-%H%M%S)"
  echo "1/5 生成新密钥（${tag}）…"
  # **先清掉上一次失败留下的半成品**：`ssh-keygen` 遇到已存在的文件会停在
  # 一个 y/n 确认上，而它的输出被 `>/dev/null` 吞掉了——看起来就是卡死
  rm -f "$KEY.new" "$KEY.new.pub"
  ssh-keygen -t ed25519 -N '' -C "$tag" -f "$KEY.new" >/dev/null
  pub="$(cat "$KEY.new.pub")"

  echo "2/5 备份 authorized_keys 并装上新钥匙（旧的先留着）…"
  # 用**你自己的主密钥**登进去：受限的那把跑不了命令。
  # `permitlisten` 按**全部**转发写（Switchback 的口加 `EXTRA` 里的远端口）——
  # 漏一个，那个口在新钥匙上就开不出来
  ssh "${SWITCHBACK_ADMIN_HOST:-kr}" "
    set -e
    cd ~/.ssh
    test -s authorized_keys
    cp authorized_keys authorized_keys.bak-\$(date +%Y%m%d-%H%M%S)
    echo 'restrict,port-forwarding,permitopen=\"127.0.0.1:1\",command=\"/bin/false\",$(listens) $pub' >> authorized_keys
    chmod 600 authorized_keys
  "

  echo "3/5 停掉旧隧道，用新钥匙起一条验一下…"
  # 托管着的话先从 launchd 撤下：不撤的话 KeepAlive 会立刻用旧钥匙把旧隧道拉回来，
  # 新钥匙那条抢不到端口
  was_managed=0
  if managed; then
    was_managed=1
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  fi
  # **不能写成 `[ -n "$pid" ] && kill …`**：没在跑的时候那一串返回 1，
  # 配上开头的 `set -e` 就是「刚装完新钥匙、脚本当场退出」
  pid="$(find_pid)"
  if [ -n "$pid" ]; then
    kill ${pid}
    sleep 1
  fi
  if ! ssh_tunnel -f -o IdentitiesOnly=yes -i "$KEY.new"; then
    echo "新钥匙起不来。**旧的还在服务器上，什么都没删** —— $0 start 就能回到原样。" >&2
    rm -f "$KEY.new" "$KEY.new.pub"
    exit 1
  fi
  sleep 1

  echo "4/5 新的能用，把旧的从服务器上删掉…"
  # **按密钥本体删，不按注释里的字符串。** 注释是自由文本：
  # 另一台机器的隧道钥匙注释里同样写着 omni-tunnel，按子串删会把它一起删掉
  #（那台机器于是在你毫不知情的情况下断了）；反过来，注释被人改过的旧钥匙又删不掉。
  # 密钥本体是唯一能认准「就是这一把」的东西
  old_key="$(awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^AAAA/) { print $i; exit } }' "$KEY.pub")"
  if [ -z "$old_key" ]; then
    echo "读不出旧公钥的本体（$KEY.pub），旧钥匙留在服务器上没删。手动清一下。" >&2
  else
    ssh "${SWITCHBACK_ADMIN_HOST:-kr}" "
      set -e
      cd ~/.ssh
      grep -vF '$old_key' authorized_keys > authorized_keys.tmp
      test -s authorized_keys.tmp
      mv authorized_keys.tmp authorized_keys
      chmod 600 authorized_keys
    "
  fi

  echo "5/5 换掉本机这一份…"
  mv "$KEY.new" "$KEY"
  mv "$KEY.new.pub" "$KEY.pub"
  chmod 600 "$KEY"
  # 原来托管着的，换回 launchd 那份（它读的就是 $KEY，现在已经是新钥匙）
  if [ "$was_managed" = 1 ]; then
    pid="$(find_pid)"
    if [ -n "$pid" ]; then
      kill ${pid}
      sleep 2
    fi
    launchctl bootstrap "$DOMAIN" "$PLIST"
    sleep 2
  fi
  echo "换好了。隧道已经用新钥匙在跑（pid $(find_pid) ），旧钥匙服务器上已删。"
  echo "服务器上留了一份 ~/.ssh/authorized_keys.bak-*，确认没问题之后可以自己清掉。"
  ;;
*)
  echo "用法：$0 install|uninstall|start|stop|status|rotate|run" >&2
  exit 2
  ;;
esac
