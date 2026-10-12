# @switchback/link

浏览器端**连上宿主的那一段**。手机端（`apps/web`）与电脑端（桌面渲染层在 `/desk/` 下的远程模式，
见 `docs/远程模式方案.md`）共用一份。

## 拥有什么

- `createTransport` —— 一条会断的 WebSocket 变成「断了会自己回来、回来时说得清停在哪」的流：
  重连退避、心跳、**代次**（过期的连接只许关掉自己）、令牌走子协议、先问令牌再开 socket
- `whoAmI` / `pair` 与令牌的存取（`tokenOf` / `rememberToken` / `forgetToken` / `guessName`）。
  手机端与电脑端**各存一套键**（`WEB_SLOT` / `DESK_SLOT`）：两个界面同源、共用一份 localStorage
- `createCalls` —— `call` → `result` 的编号、等回话、到点了结；没连上先排着，断线时已发出的失败、不重发
- `packBytes` —— 调用参数第一层的字节编成 `{ $bytes }` 上线

## 不拥有什么

- **不拥有传输层的规矩**。编号、按确认保留、分片、游标补洞在 `@switchback/wire`；
  这里用它的 `createReassembler` 重组分片，不另写一份。
- **不拥有事件语义与状态**。一个 `Event` 都不认识；事件怎么变成界面是各前端自己的事
  （手机端 `useRemote`、电脑端 `renderer/remote/`）。
- **不拥有任何判定**。谁能调哪条通道、档位钳到哪，全在宿主（`main/remote/exposure.ts`、`policy.ts`）。
  这一端跑在用户的浏览器里，改一行 JS 就绕过去了——**界面上的限制是提示，不是边界**。
- 不拥有界面。配对屏、连接条各前端自己画。

## 已知限制

- **断线时在途的调用一律失败，不重发。** 读类调用重发一次本来无害，但这一层分不出读写，
  而提交、暂存重发一次就可能做两次。代价是断线那一刻正在问的东西要重新点一次。
- **令牌存在 localStorage。** Safari 隐私模式下存不住，每次刷新都要重新配对；不用 cookie 是有意的
  （cookie 会被自动附带，就得防 CSRF）。
- **URL 写死同源的 `/api/stream`。** 页面和 API 必须由同一个宿主送出——这正是「宿主送界面」那条决定，
  不是疏忽。
- 心跳与退避的常量抄的是 codex remote-control 的实测值，没有在弱网下重新量过。
