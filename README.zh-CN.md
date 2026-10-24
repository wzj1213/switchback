# Switchback

[English](README.md) | 中文

> 原生 coding agent 的接力工作台。

**一家卡住，换一家接着干。**

在 Claude Code、Codex、Kimi Code、Grok 与 DSH 之间延续同一件工作。Switchback 会把目标、
工作树、各家的原生会话句柄，以及引擎公开可定位的原始记录路径留在同一条工作线上；每一家仍运行自己的原生进程，
使用自己的登录、模型、配置和工具。换过去时 Switchback 不替你写提示词，也不会把一份自制摘要塞进模型上下文。

接力之后也可以切回来——上一家自己的原生会话句柄仍然保留。Switchback 管的是一条工作的连续性，
不是把多家 agent 编成一支自动协作的队伍。

目前内置五家：Codex、Claude Code、Kimi Code、Grok 与 DSH；其他讲 ACP 的引擎也可以注册。

![接力怎么走：一条工作线从 Claude Code 交给 Codex、再交给 Kimi Code，最后切回 Claude Code，始终在同一个工作区上](docs/assets/relay.svg)

## 为什么需要接力

coding agent 各有所长，也都会遇到自己的问题：

- 一家卡在某个错误上，想换另一家重新判断
- 用一家梳理方案，再让另一家接着实现
- 当前引擎额度不足、服务异常，或者不适合眼前这个阶段
- 想让另一家从头再试，同时保留原来的结果

通常这意味着重开窗口、重新选择项目，再找回上一家改到了哪里。
Switchback 保留同一个工作区、界面历史和每家的原生句柄；需要新引擎看上一段原文时，
从时间线拿到该引擎确实提供的记录路径，再由你明确让它自己读取。

## 接力怎么工作

接力不等于把一家模型的上下文翻译成另一家的私有 session 格式。

默认情况下，换过去之后的第一句话前面会附一段只陈述事实的交接说明：此前哪一家跑了哪几轮、
Switchback 整理的转写和各段原始记录在哪、那些记录是什么格式。它不下任务、不做评价，原样显示在转录区；
可以在「设置 → 通用 → 自动交接」里关掉。

| 会继续保留 | 不会自动送进新引擎上下文 |
| --- | --- |
| 同一个工作区与磁盘上的真实文件 | Switchback 编写的摘要、提示词或提醒 |
| Switchback 界面里的完整工作线 | 另一家引擎的隐藏推理与私有模型上下文 |
| 每一家自己的原生会话句柄 | 凭证与登录信息 |
| 引擎确实公开的原始记录路径（若有） | Switchback 猜测出来的状态 |

工作区是真源；接手后你可以直接给下一句，也可以明确给出时间线里的路径，让它自行核对原文和代码。

## 三种换法

1. **从合适的一家开始**：新工作直接选择引擎。
2. **让另一家接着做**：先选下一家，等你发出下一句话时才切换；原工作线和各家句柄都保留。
3. **换一家从头再试**：保留原结果，另开一条同工作区分支；跨引擎时不自动注入目标或摘要。

同一家且引擎公开原生 fork 时，第三种会复制它自己的真实上下文；换一家时只能诚实地开空白分支，
不会附带「已改过哪些文件」——否则另一家会误以为工作已经做了一半。
有血缘的两条分支可以从顶栏或 `/compare` 进入并排对比：先看两边各自上报的文件、
未完成项与最后结论，再按需下钻两栏原始记录。两边仍共用同一个工作区，后跑的一家
会看见先跑一家的改动，所以界面会明确提醒它不是一组隔离的对照实验。

## “原生”意味着什么

Switchback 启动的是你本机已经安装并登录过的 coding agent：

- **不另外索要或代管凭证。** 没有 Switchback 自己的 API key、OAuth 或 token 仓库。
- **不代理模型请求。** 请求由各家原生进程直接发出。
- **不重写 agent loop、提示词或工具。** 各家的上游升级会被原样继承。
- **不替引擎猜能力和状态。** 引擎报告什么，界面就展示什么；分辨不出就明确说不知道。
- **不碰凭证存储。** 不读 `.credentials.json`、`auth.json` 这类凭证文件，也不访问钥匙串。
  Switchback 会解析各家的配置文件来说明哪些钩子正在生效，只保留钩子相关字段；
  具体读哪些文件见下文[「本机数据与网络」](#本机数据与网络)。

源码仓库不包含任何一家的二进制。Claude 完整版使用官方 Agent SDK 提供的平台可执行文件；
轻量版则使用 `PATH` 上已有的 `claude`。

如果你要的是统一模型网关、自己实现的 agent harness，或自动多 agent 编排，Switchback 不是那个产品。

## 一条工作线里有什么

- **统一会话**：正文、计划、工具调用、用量、错误和引擎状态用同一套界面呈现
- **审批与信任档**：不同引擎的原生审批进入同一套可追溯的人工裁决
- **真实变更**：从 git 工作区生成变更汇总与审核面板，不只相信引擎自报的编辑；看完可以直接暂存、提交（提交能撤销，只在本地，不推送）
- **项目与环境**：查看分支、工作树状态、项目指令与各家原生 hooks，继续 agent 会话
- **断点续跑**：事件落盘、原生句柄恢复、正文搜索与跨会话回看
- **远程接管**：从手机或浏览器查看进度、继续对话、处理审批与结构化问题并接收通知

## 适合谁

Switchback 适合同时使用两家以上原生 coding agent、希望保留各家订阅与配置，
又不想每次切换都重新交代工作的开发者。

它不适合需要统一模型 API、云端 IDE、自动并行 agent 团队，或者纯命令行工作流的人。
Switchback 唯一的用户界面是 GUI；命令行只用于开发和打包。

## 支持的引擎

| 引擎 | 原生入口 | 状态 |
| --- | --- | --- |
| Codex | `codex app-server --stdio` | 内置 |
| Claude Code | Agent SDK | 内置 |
| Kimi Code | `kimi web` REST + WebSocket | 内置 |
| Grok | ACP | 内置 |
| DSH | `dsh --profile <profile>`（ACP） | 内置；按 profile 选择插件组装并确认接入 |
| 其他 ACP 引擎 | ACP 官方注册表一键接入，或指一个可执行文件 | 按引擎自报能力接入；登录走它自己报的方式 |

内置引擎会显示真实探测状态；DSH 设置页会从各 profile 的 `package.json` 展示 bundle 加载顺序、
profile 声明的直接依赖与 patch 状态。确认当前 profile 的原生配置后它才进入清单；会话会记住创建时的 profile，
以后切默认组装也不会把旧句柄送进另一棵插件树。插件通过 ACP 自报的新模型、命令和会话能力会沿用通用驱动，
用户自配的 ACP 引擎则只有注册后才会出现。

第三方 ACP 引擎在设置 →「安装与接入」里接：

- **从 ACP 注册表接入**：列出 [ACP 官方注册表](https://agentclientprotocol.com/registry)里各家自己登记的
  启动方式（Gemini CLI、GitHub Copilot、goose、OpenCode、Qwen Code……）。点「接入」先摆出要执行的命令
  或要下载的包与校验值，确认后装好、握手试接、写进 `engines.json`，不用重启；注册表有新版时给「升级」。
- **手动接入**：注册表里没有的，指一个可执行文件，答得上 ACP 握手才让接。
- **登录**：试接时列出它自己报的登录方式。浏览器那一类由它自己办（Switchback 只转一次 `authenticate`），
  终端那一类在系统「终端」里跑它自己的登录界面。开会话时它说要先登录，界面会显示「需要登录」并给出去登录的路。

## 跑起来

开发环境：

- macOS。这是目标平台；Linux / Windows 只在 CI 上跑类型检查和引擎包测试。
- Node **22.23.2**（见 `.node-version`）。
- pnpm **11.18.0**。`corepack enable` 之后会按 `package.json` 的 `packageManager` 自动取用这个版本。
- 第一次跑测试或开发模式时，会从 GitHub 下载 Electron 运行时（约 130 MB）。

```sh
corepack enable
pnpm install
pnpm dev          # 开发模式
pnpm check        # typecheck / lint / 架构守卫 / 日志守卫 / 测试
pnpm dist         # 完整版 .dmg：内置 Claude 平台可执行文件
pnpm dist:thin    # 轻量版 .dmg：使用 PATH 上的 claude
pnpm dist:all     # 一次生成两种
pnpm test:live    # 真引擎测试，默认不跑；需要本机装好并登录对应引擎
```

使用前提：机器上装好要使用的原生 agent（`codex` / `kimi` / `grok` / `dsh`）并按各家方式完成登录；
Claude 完整版内置 SDK 对应的平台可执行文件，轻量版要求 `claude --version` 可运行。
DSH 还要求在 DSH Web 的 Models 设置里配好 provider、model 与 API 凭证，并让选中的 profile
能完成 ACP 握手；之后在 Switchback 的设置 → 引擎 → DSH 中选择 profile 并确认接入。
profile、凭证与插件版本仍由 DSH 自己管理；当前官方 automation-only ACP 没有报告续跑能力时，
Switchback 会明确拒绝恢复旧会话，不会静默开一条空会话冒充接上。
它当前也只从 ACP 提交最终 assistant 文本，推理与工具活动留在 DSH 自己的 session log；
因此 Switchback 的转录区不会编造缺席的工具行，最终文件变化仍由工作树开场基线与审核面板核对。
Switchback 直接使用各家的原生登录态，不另外配置密钥。

当前打出来的包没有签名（`identity: null`）。首次打开要在
「系统设置 → 隐私与安全性」里放行，或者运行：

```sh
xattr -dr com.apple.quarantine /Applications/Switchback.app
```

远程访问的配对、隧道与设备吊销见 [`docs/远程访问设置.md`](docs/远程访问设置.md)。

## 本机数据与网络

### 会读取的别家文件

这些文件都只在本机使用，Switchback 不会把它们发出去。

| 读什么 | 为什么 | 留下什么 |
| --- | --- | --- |
| `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.kimi-code/config.toml`、`~/.grok/` 下的配置与 hooks，以及项目里的同名文件 | 在「环境」页列出正在生效的钩子 | 只留钩子相关字段。这些文件里如果写着 provider key，会随整份文件一起被解析，但不会保留 |
| `~/.claude/projects/` 下的会话记录 | 列出、接管 Claude 的历史会话 | 接管时，把最近的记录写进 Switchback 自己的会话日志 |
| `~/.claude.json` | 只在 SDK 取不到账号信息时，用来显示登录的是谁 | `oauthAccount` 里的名字、邮箱、套餐 |
| `~/.kimi-code/session_index.jsonl`、`~/.grok/sessions/` 的目录结构 | 在时间线上给出引擎原始记录的路径 | 只定位路径，不读记录内容 |
| `~/.dsh/profiles/*/package.json` | 展示 DSH 各 profile 的组装情况 | bundle 顺序与依赖版本 |
| 项目里的 `AGENTS.md`、`CLAUDE.md` | 判断项目指令在不在 | 只看文件是否存在 |

- **账号与额度**：优先走各家接口，也就是 Claude Agent SDK、`codex app-server` 和 `kimi web` 的本地 API。
- **Kimi 的本地会话 token**：来自 Switchback 自己启动的 `kimi web` 进程的输出，只放在内存里，只发往回环地址。
- **环境变量与 PATH**：引擎子进程继承你的环境变量。启动时，Switchback 会以登录 shell 取一次 `PATH`，这会执行你的 shell 配置文件。

### Switchback 自己存的东西

数据目录是 `~/Library/Application Support/Switchback`，里面有：

- 设置、审批规则、粘贴进来的图片
- 会话事件流，包含完整的提示词、回复和工具输出
- 日志，其中像凭证的字符串会被抹去
- `engines.json`：写在它 `env` 里的值是明文
- `agents/`：从 ACP 注册表接入的二进制引擎，每家每个版本一个目录；没人用的旧版本会被清掉
- `acp-registry.json`：ACP 注册表的本机缓存
- 远程设备表：令牌只存哈希

不属于任何项目的对话，会在 `~/Documents/Switchback/` 下建目录。

### 网络

Switchback 没有遥测、统计或崩溃上报，崩溃转储只留在本机。Switchback 自己发起的联网只有下面这些：

- **引擎版本检查**：启动约 8 秒后运行。对用 npm 全局安装的 codex / kimi 执行 `npm view`，装了 grok 时执行 `grok update --check`。
- **应用更新检查**：`apps/desktop/package.json` 里的 `updateFeed` 默认为空，也就是整个关闭。
- **ACP 注册表**：打开设置里的「安装与接入」、而本机缓存超过一小时时，从 `cdn.agentclientprotocol.com`
  取一次注册表（约 60 KB）；点「刷新」也会取。
- **你在「安装与接入」里点「接入」「升级」时**：npx / uvx 分发的由它们按你自己的 npm / uv 配置下载包；
  二进制分发的由 Switchback 从注册表登记的地址下载，并按注册表给的 sha256 校验。
- **你点某种「登录」时**：由那一家引擎自己联网（通常会打开浏览器），Switchback 只转达你选的方式。
- **远程访问**：默认关闭；打开后也只监听 `127.0.0.1`，由你自己的隧道暴露出去。开启通知后，会向浏览器的推送服务发送加密消息。
- **你在设置里点「安装 / 更新」引擎时**：执行对应的安装命令。

模型请求、登录和引擎自己的更新，都由各家原生进程发出。

## 架构与开发

![Switchback 的架构：桌面窗口与网页端连到主进程；主进程里的包从 protocol 往上一层层叠到 host；各家引擎是独立进程，调用各自的模型服务](docs/assets/architecture.svg)

```
packages/
  protocol/   领域模型 thread / turn / item（零依赖，纯类型）
  approval/   信任档 + 红线表 + 判定器（纯函数，零 IO）
  store/      事件流到视图状态的纯归约器
  wire/       序号、重放、分片与补洞
  link/       远程传输：断了会自己重连，回来时说得清停在哪
  engine/     原生引擎驱动：acp / codex / claude / kimi
  worksite/   工作区安全：git guard、写范围
  journal/    持久化、断点、恢复
  handoff/    运行摘要与分支对比（不发送给引擎）
  host/       会话编制与进程生命周期
apps/
  desktop/    Electron 壳 + React 渲染层
  web/        远程浏览器端
```

精确依赖边由 `pnpm arch` 强制，依赖增删必须同步改真源：

<!-- package-graph:start -->
```text
protocol ← ∅
approval ← i18n + protocol
store ← protocol
wire ← protocol
link ← protocol + wire
worksite ← ∅
i18n ← ∅
journal ← protocol
handoff ← protocol
engine ← protocol + approval + i18n
host ← protocol + approval + engine + store + journal + handoff + i18n
desktop ← protocol + engine + handoff + host + i18n + journal + link + store + wire + worksite
web ← i18n + link + protocol + store + wire
```
<!-- package-graph:end -->

```sh
pnpm check       # 提交前必须全绿
pnpm test:watch
```

工程规范见 [`AGENTS.md`](AGENTS.md)。名字是山路上的之字形折返道（switchback）：坡太陡，就折个弯接着往上走；也是字面上的「切回去」——接力之后，随时能切回上一家。

## 许可与商标

Switchback 的源码以 [Apache License 2.0](LICENSE) 发布。

- **Claude Agent SDK 不在此列。** `@anthropic-ai/claude-agent-sdk` 及其平台可执行文件是 Anthropic 的专有软件，
  使用受 Anthropic 的条款约束。
  - 源码仓库只通过 npm 依赖它。
  - `pnpm dist` 打出的完整版会把 SDK 和平台可执行文件放进安装包。
  - 轻量版只带 SDK 的 JavaScript 部分，不带平台可执行文件。
  - 自行分发安装包之前，请先确认符合 Anthropic 的条款。
- **与各厂商无关联。** Switchback 是独立的个人项目，与 Anthropic、OpenAI、Moonshot AI、xAI、DeepSeek
  以及其他引擎的提供方都没有关联，也没有获得它们的认可或赞助。
  Claude、Claude Code、Codex、Kimi、Grok、DSH 等名称与商标归各自的所有者所有，
  本文提到它们只是为了说明 Switchback 能驱动哪些引擎。
