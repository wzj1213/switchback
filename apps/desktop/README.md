# @omni/desktop

Electron 壳 + React 渲染层。**这是 omni 唯一的用户界面**——没有面向用户的 CLI。

三个进程角色：

| 角色 | 职责 |
| --- | --- |
| `src/main` | 起窗口；将来在这里跑 `@omni/host`，引擎子进程住在这一侧 |
| `src/preload` | 只暴露一条窄通道：渲染层发 `Command`，接收 `Event` |
| `src/renderer` | 只认 `@omni/protocol` 的事件模型，不知道任何一家引擎的存在 |

## 拥有什么

- 窗口生命周期、菜单、主题
- 渲染层：会话列表、transcript、审批卡、composer
- `Command` / `Event` 的 IPC 传输

## 不拥有什么

- **不拥有引擎驱动**。渲染层不 spawn 进程、不解析任何一家的协议。
- 不拥有审批判定。判定在 `@omni/approval`，这里只渲染 `escalate` 出来的卡片。
- 不拥有持久化。落盘在 `@omni/journal`。
- 不拥有业务编排。跨会话、跨引擎的编制在 `@omni/host`。

## 为什么 desktop 直接依赖了 Claude 的 SDK

`@omni/engine` 是 workspace 源码，会被**打进** main 进程产物。产物因此继承了
engine 的运行时依赖，而 Node 从产物所在目录往上找 `node_modules`——
所以这些依赖必须出现在 app 根目录，否则运行时报 `ERR_MODULE_NOT_FOUND`。
每新增一个引擎驱动，它的运行时依赖都要在这里跟着加一条。

## 签名与公证

配置已经就位（`electron-builder.yml` + `build/entitlements.mac.plist`），
**缺的只是凭据**。齐了之后一条命令就能出签名包，不用改任何代码：

```sh
CSC_NAME="Developer ID Application: <名字> (<TeamID>)" \
APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... \
pnpm dist:signed
```

`pnpm dist` **永远不签名**（它显式设了 `CSC_IDENTITY_AUTO_DISCOVERY=false`）。
这不是保守：不关的话 electron-builder 会去翻钥匙串、抓到任何一张证书就开始签，
而一张不受信任的证书会让 `codesign` 卡在逐个文件签名上——实测跑了 400 秒
还停在 `locale.pak`，得手动 kill。

需要三样：Apple Developer Program 会员（99 美元/年）、钥匙串里的
Developer ID Application 证书、App Store Connect 的 app-specific password。

### 强化运行时已经验过了，不用等证书

公证强制要求强化运行时，而**强化运行时默认会掐掉 omni 赖以工作的两件事**：
V8 的 JIT，以及「加载别人签的二进制」——后者正是这个产品的核心
（spawn codex / ACP 适配器 / Claude SDK 自带的 CLI）。
等付完钱那天才第一次打开它，就要在最不该调试的时刻调试它。

用 ad-hoc 签名可以提前把这条路走完（`--sign -` 不需要任何证书，
但一样应用 `--options runtime` 与授权清单）：

```sh
codesign --force --deep --options runtime \
  --entitlements apps/desktop/build/entitlements.mac.plist \
  --sign - release/mac-arm64/omni.app
codesign -d --verbose=2 release/mac-arm64/omni.app   # 应含 flags=…(adhoc,runtime)
codesign -d --entitlements - release/mac-arm64/omni.app
```

已实测：`flags=0x10002(adhoc,runtime)`、六条授权全部生效，
应用能起、渲染层能画、`which` 探测能跑、codex 子进程能 spawn 并读文件。
**如果哪天加了新的原生依赖或新的子进程，重跑一遍这三条命令再发版。**

## 本机自更新：改完代码，在应用里点一下

装在 `/Applications/omni.app` 的那份是从**这台机器上的源码**打出来的，所以
「让刚改的代码生效」这件事不必绕一圈终端。侧栏底下那一行（`UpdateRow`）
在**有源码比这份包新**时出现，点它就是：

```
pnpm --filter @omni/desktop run dist:local   # 只出 .app，不打 DMG（实测 ~11 秒）
ditto → 换掉 /Applications/omni.app → open   # 由一个独立脚本在应用退出后做
```

三件事值得知道：

- **判据是文件时间，不是版本号。** 版本号来自 git 提交数，而开发时的改动
  大多还没提交——按版本号比，改完它会说「已经是最新」。所以直接问文件系统：
  有没有源码文件比装着的这份包新（`find -newer`，剪掉 node_modules/.git/release/out/dist）。
- **源码路径是打包时烤进去的**（`omni.repo`，见 `scripts/stamp-version.mjs`）。
  包拷到别人机器上时那个路径不存在，这一行**整个不出现**——不是灰掉，是不画。
- **换包在应用退出之后由独立进程做**：等旧进程真的退出 → `ditto` 到旁边 →
  同目录两次 `mv`（同盘原子）→ 失败就把旧的挪回来。这一步没有界面能报错，
  所以它有一条**真跑一遍**的测试（`selfupdate.test.ts`）。

第一次（或者按钮本身坏了）手动装：**先退出 omni**，然后

```sh
pnpm --filter @omni/desktop run dist:local
ditto release/mac-arm64/omni.app /Applications/omni.app.新 \
  && rm -rf /Applications/omni.app \
  && mv /Applications/omni.app.新 /Applications/omni.app \
  && open /Applications/omni.app
```

## 更新检查（远端）

**只查不装，这是有意的。** macOS 上装更新走 Squirrel.Mac，而它会校验新旧两个
版本的代码签名——没签名的应用它根本不会给你装。硬塞一个 `electron-updater`
进来只会在下载完之后卡在安装那一步，而**一个走到最后一步才失败的更新流程，
比没有更新流程糟**。

feed 地址填在 `apps/desktop/package.json` 的 `omni.updateFeed`
（`OMNI_UPDATE_FEED` 可覆盖，企业内网自建源用得上）。**留空 = 整个功能不存在**：
不发请求、不起定时器、菜单里也不出现「检查更新…」。

源返回一个 JSON：

```json
{ "version": "1.2.3", "url": "https://…/omni-1.2.3.dmg", "notes": "改了什么" }
```

`url` **只认 https**——一个能被改成 `http://` 或 `file://` 的更新地址，
就是一条能把用户引去任意地方的路。

## 通知：出声的三件事，以及一个已知的洞

「跑完了 / 跑挂了 / 有人等你批」会发系统通知（`main/attention.ts`）。四条克制：
窗口在前台不弹、同一件事只弹一次、**15 秒以内跑完的不弹**（那种你八成还盯着屏幕）、
**自己按停的不弹**（那是你刚做的动作，报告它等于回声）。

**已知的洞**：窗口在前台、但你看的是**另一条**会话时收不到任何信号——
主进程不知道渲染层选中的是谁，所以老实按「窗口是否前台」抑制，宁可少响一次。
要补得让渲染层把当前选中的会话报上来，那是另一条通道。

Dock 角标只算**挂起的审批**，不算在跑的轮次：角标是「有事等你做」，不是「它在忙」。

## 长任务：挡待机 + ⌘Q 确认

有会话在跑或等审批时，主进程持一个 `powerSaveBlocker`（`main/awake.ts`），全跑完立刻放开。
同一批判据（`busy()`）也决定 ⌘Q 要不要先弹确认（`main/quit.ts`）——闲着的时候一句不问，
因为每次退出都弹框，人很快就学会闭着眼按回车。

三件给不出的承诺，写在这儿免得日后当成 bug 查：

- **合上盖子照样睡。** macOS 的 clamshell sleep 没有任何电源断言拦得住。
- **只挡闲置待机，不挡屏幕休眠**（`prevent-app-suspension`，不是 `prevent-display-sleep`）。
  后者会让笔记本亮一整夜——那是把一个小问题换成一个更烦人的问题。
- **非 mac 上关掉最后一扇窗不问确认**（`window-all-closed` 走 `quitNow()`）。
  那时已经没有窗口了，点「取消」会得到一个没有窗、没有托盘图标、
  只能去任务管理器里找的应用——比静默退出更难收场。

## 已知限制

- **打出来的包仍然没有签名**：本机只有一个自签且 `CSSMERR_TP_NOT_TRUSTED` 的证书，
  electron-builder 会拒绝用它，于是照旧 skip 签名。上面那段配置只有在
  `CSC_NAME` 指向一个真证书时才生效。首次打开仍需在「隐私与安全性」里放行。
- **Linux / Windows 的包必须在对应平台上打。** Claude Agent SDK 的原生二进制
  按平台分包，现在已经显式列进 `optionalDependencies`（每个都带 os/cpu 字段，
  所以本机只装 darwin-arm64 那一个，不占地方）。但**在 macOS 上交叉打 Linux 包
  仍然拿不到 linux 的那个**——那台机器上根本没装。CI 的三格里各打各的才对。
  在真机上跑过之前，这仍然算未验证。
- **只在 macOS 上验过。** 平台差异收在 `@omni/engine` 的 `platform.ts` 一处：
  查命令（`which` / `where.exe`）与进程树回收（负 pid 信号 / `taskkill /T /F`）。
  Windows 那几支**没有在真机上跑过**——写它们是因为原来的实现在 Windows 上
  是默默错的（负 pid 不是进程组），错得无声无息比明说不支持糟得多。
  另外那边拿不到「整树退出证明」，`TreeControl.provesWholeTree` 会照实报 false。
- **引擎探测会错，所以从不硬拦。** 探出「未安装」的引擎在选择器里只加个记号，
  照样能选——灰掉一个其实能用的引擎，比不检查更糟：用户会相信自己没装，去装第二遍。
  只有一键分叉会跳过它们（那个动作没有确认步骤）。
- **崩溃转储只留在本机**，一个字节都不上传（`uploadToServer: false`）。
  转储里可能有内存快照，而内存里装着用户的代码与提示词。诊断报告只列文件名和时间。
- **主进程崩溃只能靠下次启动时发现**（运行标记文件）——主进程死了就没人记日志了。
  正常退出删标记，下次发现标记还在就说明上次是崩着走的。
- **补发缓冲只有 5000 条。** 超过这个的缺口补不回来，渲染层会重载页面走全量重建。
  这不是静默降级：主进程会记一条 `补发失败` 到日志里。
- 主题只做了浅色 + 跟随系统的深色 token，**没有手动切换**。
- 应用 576 MB / DMG 208 MB。大头是 Electron 运行时与 Claude SDK 自带的 CLI。
- **变更汇总卡分不出「谁改的」。** 上半节是引擎自己报的编辑，可追溯到某一条工具行；
  下半节是问 git 得来的，**它分不出是引擎跑的命令改的、还是你自己在编辑器里改的**，
  文案也就照实这么写。要分得出，得在会话开始时留一份基线快照并跟着落盘——
  那是另一件事，没做之前不假装做到了。
- `⌘F` 查找覆盖**整个窗口**，侧栏预览与查找框自身也算命中——
  排掉它们需要让输入框不可输入，而中文 IME 需要一个真正获得焦点的 input，
  不划算。计数上挂了 tooltip 说明。
