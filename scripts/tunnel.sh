#!/usr/bin/env bash
# omni 的反向隧道：把本机的远程口送到中转服务器的回环上。
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
# 只有一件事：开 `127.0.0.1:17800` 这一个反向端口。服务器上的 authorized_keys
# 写死了 `command="/bin/false"`（连一条命令都跑不了）和 `permitlisten`
# （开不了别的端口）。泄漏出去的最坏后果是有人能占用那个端口，**不是拿到你的服务器**。
set -euo pipefail

HOST="${OMNI_TUNNEL_HOST:-kr-omni}"
PORT="${OMNI_TUNNEL_PORT:-17800}"
LOCAL="${OMNI_TUNNEL_LOCAL:-17800}"
KEY="${OMNI_TUNNEL_KEY:-$HOME/.ssh/omni-tunnel}"
# 认自己的进程用这个标记，不靠 pgrep 猜端口号——那会误伤别人的隧道
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
    -o "SetEnv=OMNI_TAG=$TAG" \
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
  tag="omni-tunnel-$(date +%Y%m%d-%H%M%S)"
  echo "1/5 生成新密钥（${tag}）…"
  ssh-keygen -t ed25519 -N '' -C "$tag" -f "$KEY.new" >/dev/null
  pub="$(cat "$KEY.new.pub")"

  echo "2/5 备份 authorized_keys 并装上新钥匙（旧的先留着）…"
  # 用**你自己的主密钥**登进去：受限的那把跑不了命令
  ssh "${OMNI_ADMIN_HOST:-kr}" "
    set -e
    cd ~/.ssh
    test -s authorized_keys
    cp authorized_keys authorized_keys.bak-\$(date +%Y%m%d-%H%M%S)
    echo 'restrict,port-forwarding,command=\"/bin/false\",permitlisten=\"127.0.0.1:$PORT\" $pub' >> authorized_keys
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
    -o "SetEnv=OMNI_TAG=$TAG" \
    -R "127.0.0.1:$PORT:127.0.0.1:$LOCAL" \
    "$HOST"; then
    echo "新钥匙起不来。**旧的还在服务器上，什么都没删** —— $0 start 就能回到原样。" >&2
    rm -f "$KEY.new" "$KEY.new.pub"
    exit 1
  fi
  sleep 1

  echo "4/5 新的能用，把旧的从服务器上删掉…"
  ssh "${OMNI_ADMIN_HOST:-kr}" "
    set -e
    cd ~/.ssh
    grep -v 'omni-tunnel' authorized_keys > authorized_keys.tmp || true
    grep '$tag' authorized_keys >> authorized_keys.tmp
    test -s authorized_keys.tmp
    mv authorized_keys.tmp authorized_keys
    chmod 600 authorized_keys
  "

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
