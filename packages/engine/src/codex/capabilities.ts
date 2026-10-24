import type { EngineCapabilities } from "@switchback/protocol"

/**
 * codex 这一家能做什么。从 `driver.ts` 挪出来是行数闸门逼的，判据照旧写在每一项旁边。
 *
 * `thread/compact/start` **不在 `skills/list` 里**，所以 `compact` 必须由 Switchback 给入口。
 */
export const CODEX_CAPABILITIES: EngineCapabilities = {
  compact: true,
  attachments: true,
  steer: true,
  fork: true,
  rewind: true,
  // `modeReadback`：**五家里唯一一个真的**。前置（`claims.ts` 那张认领表 + 双向
  // CI 断言）已经建好，`thread/settings/updated` 也真有人接（`notify.ts` →
  // `adoptSettings`）。这一位曾经落在 false 上没跟着翻——那次提交的说明里写着
  // 「从 false 翻成 true」，而 diff 里这一行根本没动，于是界面上照旧挂着
  // 「这家不会把它自己改的档告诉 Switchback」，而它明明会。
  modeReadback: true,
  // `sideQuestion`：codex 的侧问只活在它自己的 TUI 里（`tui/src/app/side.rs`），
  // **没从 app-server 那扇门出来**。照着拼要 Switchback 抄一份它的边界提示词进来维护，
  // 撞 AGENTS.md 的总纲——见 `docs/侧栏与引擎状态方案.md` §0
  sideQuestion: false,
  // 0.149.0 的公开 thread/read 已在生产历史抓到 SubAgentActivity，子 thread 的
  // started/status 通知也有稳定协议；这里只镜像 Codex 自己启动的活动，不做编排。
  activity: true,
}
