# @switchback/i18n

界面语言与文案的**类型**。零依赖，零 IO。

## 拥有什么

- `Locale`（`"zh-CN" | "en"`）、`DEFAULT_LOCALE`（中文）、`isLocale`、`langTag`
- `LOCALE_NAMES`：每种语言用它自己的文字怎么称呼自己（「简体中文」「English」），选语言的地方照它显示
- `defineMessages(zh, en)`：一份文案的中英两版。一条文案是一句话、一个拼句子的函数，或一张「id → 名字」的表；英文那一版少一个键（表里的也算）、带参数的文案参数对不上，类型检查都过不去
- `count`：英文的单复数

## 不拥有什么

- **具体的文案**：各包、各应用旁边的 `*.messages.ts` 拥有自己的文案，这里除了语言自己的名字一句都不放
- **当前是什么语言**：读设置、看系统语言是调用方的事，`Locale` 由调用方传进来
- **日期、数字、相对时间的格式**：直接用 `Intl.*`，参数给 `langTag(locale)`
- **引擎自己报的原话**：照原样显示，不翻译（见 `AGENTS.md` 的产品边界）

## 术语表

英文版统一用这些译名，别的说法一律不用：

| 中文 | English |
| --- | --- |
| 会话 | thread |
| 工作线 | work line |
| 引擎 | engine |
| 原生会话句柄 | native session handle |
| 接力、换一家 | hand off, switch engines |
| 切回去 | switch back |
| 交接说明 | handoff note |
| 原始记录 | raw log |
| 转写 | transcript |
| 分叉 | fork |
| 轮次 | turn |
| 审批 | approval |
| 信任档 | trust tier |
| 红线 | red line |
| 审核（改动） | review |
| 工作区 | workspace |
| 项目 | project |
| 侧栏 | sidebar |
| 侧边面板 | side panel |
| 工作台 | workbench |
| 桌宠 | pet |
| 外发守卫 | egress guard |
| 远程 | remote |
| 配对 | pair |
| 思维档、强度 | reasoning level |
| 侧问 | side question |
| 计划 | plan |
| 目标 | goal |
| 那台机器（宿主） | host machine |
| 试接 | try（按钮叫 Try） |
| 接入（一家 ACP 引擎） | connect |
| 登录、退出登录 | sign in, sign out |
| 重新探测 | detect again |

## 已知限制

- 只有中文、英文两种；加一种语言要改 `Locale`，并给每一份 `*.messages.ts` 补一版
- 切语言之后，**已经显示出来的**引擎状态、通知、转录区里的提示行不回头重写；之后新产生的才换语言
- 回给引擎进程的 JSON-RPC 错误、进程收摊时拒掉的调用，仍是原来的中文（标了 `i18n-ok`）：那是协议层的话，不上界面
- 文案是编译进代码的 TS 对象，没有运行时加载的语言包
