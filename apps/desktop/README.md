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
pnpm dist
```

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

## 更新检查

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

## 已知限制

- **打出来的包仍然没有签名**：本机只有一个自签且 `CSSMERR_TP_NOT_TRUSTED` 的证书，
  electron-builder 会拒绝用它，于是照旧 skip 签名。上面那段配置只有在
  `CSC_NAME` 指向一个真证书时才生效。首次打开仍需在「隐私与安全性」里放行。
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
- `⌘F` 查找覆盖**整个窗口**，侧栏预览与查找框自身也算命中——
  排掉它们需要让输入框不可输入，而中文 IME 需要一个真正获得焦点的 input，
  不划算。计数上挂了 tooltip 说明。
