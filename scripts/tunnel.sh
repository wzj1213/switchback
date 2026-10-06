#!/usr/bin/env bash
# Switchback 的反向隧道：把本机的远程口送到中转服务器的回环上。
#
#   scripts/tunnel.sh start | stop | status | rotate
#
# ## 为什么是 ssh -R 而不是自己写一个中继
#
# 中转那台机器上**一行代码都不用跑**。没有要维护的进程、没有要升级的依赖、
# 没有一个「中继自己有漏洞」的新面。ssh 这条路已经被审了三十年。
#
# ## 这把钥匙能做什么
#
# 只有一件事：开 `127.0.0.1:17800` 这一个反向端口。
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
# 认自己的进程用这个标记，不靠 pgrep 猜端口号——那会误伤别人的隧道
# `kr-omni`、`omni-tunnel` 这几个值**改名之后也不动**：它们是 ~/.ssh/config 里的主机别名、
# 钥匙文件名和正在跑的隧道命令行里的标记，改了就认不出已有的钥匙和进程
TAG="omni-tunnel-$PORT"

# **变量后面紧跟全角字符时必须用 `${x}`。** 某些 locale 下 bash 会把
# `）` 的 UTF-8 字节当成变量名的一部分，于是 `$pid）` 变成一个叫
# `pid\xef\xbc\x89` 的变量——配上 `set -u` 就是「unbound variable」，
# 而报错信息里那个变量名看起来和你写的一模一样。
find_pid() {
  pgrep -f "$TAG" || true
}

case "${1:-status}" in
start)
  if [ -n "$(find_pid)" ]; then
    echo "已经在跑了（pid $(find_pid) ）"
    exit 0
  fi
  # ExitOnForwardFailure：端口被占时**当场退出**，而不是留下一条通了 ssh
  # 却没转发成的连接——那种连接看起来是好的，直到你在手机上打不开
  ssh -f -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o BatchMode=yes \
    -o "SetEnv=SWITCHBACK_TAG=$TAG" \
    -R "127.0.0.1:$PORT:127.0.0.1:$LOCAL" \
    "$HOST"
  sleep 1
  echo "隧道已起：$HOST 的 127.0.0.1:$PORT → 本机 127.0.0.1:$LOCAL"
  ;;
stop)
  pid="$(find_pid)"
  if [ -z "$pid" ]; then
    echo "没在跑"
    exit 0
  fi
  kill ${pid}
  echo "已停（pid ${pid} ）"
  ;;
status)
  pid="$(find_pid)"
  if [ -z "$pid" ]; then
    echo "隧道：没在跑"
  else
    echo "隧道：在跑（pid ${pid} ）"
  fi
  ;;
rotate)
  # 换钥匙。**顺序是「装上新的 → 验它真的能用 → 才删旧的」**，
  # 中间任何一步失败，旧钥匙都还在服务器上，隧道照样起得来。
  #
  # 原来这里是「先 grep -v 删掉旧行、再追加新行」——那一步里
  # 新旧同时不成立，而且没有任何东西验过新的那把能不能用。
  # 这是一次性的、动别人服务器的操作，失败的代价是「人在外面、门开不了」。
  # 端口要先验成纯数字：下面它会被拼进服务器上执行的那段 shell
  case "$PORT" in
  '' | *[!0-9]*)
    echo "端口不合法：$PORT" >&2
    exit 2
    ;;
  esac
  tag="omni-tunnel-$(date +%Y%m%d-%H%M%S)"
  echo "1/5 生成新密钥（${tag}）…"
  # **先清掉上一次失败留下的半成品**：`ssh-keygen` 遇到已存在的文件会停在
  # 一个 y/n 确认上，而它的输出被 `>/dev/null` 吞掉了——看起来就是卡死
  rm -f "$KEY.new" "$KEY.new.pub"
  ssh-keygen -t ed25519 -N '' -C "$tag" -f "$KEY.new" >/dev/null
  pub="$(cat "$KEY.new.pub")"

  echo "2/5 备份 authorized_keys 并装上新钥匙（旧的先留着）…"
  # 用**你自己的主密钥**登进去：受限的那把跑不了命令
  ssh "${SWITCHBACK_ADMIN_HOST:-kr}" "
    set -e
    cd ~/.ssh
    test -s authorized_keys
    cp authorized_keys authorized_keys.bak-\$(date +%Y%m%d-%H%M%S)
    echo 'restrict,port-forwarding,permitopen=\"127.0.0.1:1\",command=\"/bin/false\",permitlisten=\"127.0.0.1:$PORT\" $pub' >> authorized_keys
    chmod 600 authorized_keys
  "

  echo "3/5 停掉旧隧道，用新钥匙起一条验一下…"
  # **不能写成 `[ -n "$pid" ] && kill …`**：没在跑的时候那一串返回 1，
  # 配上开头的 `set -e` 就是「刚装完新钥匙、脚本当场退出」
  pid="$(find_pid)"
  if [ -n "$pid" ]; then
    kill ${pid}
    sleep 1
  fi
  if ! ssh -f -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -i "$KEY.new" \
    -o "SetEnv=SWITCHBACK_TAG=$TAG" \
    -R "127.0.0.1:$PORT:127.0.0.1:$LOCAL" \
    "$HOST"; then
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
  echo "换好了。隧道已经用新钥匙在跑（pid $(find_pid) ），旧钥匙服务器上已删。"
  echo "服务器上留了一份 ~/.ssh/authorized_keys.bak-*，确认没问题之后可以自己清掉。"
  ;;
*)
  echo "用法：$0 start|stop|status|rotate" >&2
  exit 2
  ;;
esac
