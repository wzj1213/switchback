import { defineMessages } from "@switchback/i18n"

/** Antigravity 会话自己说的几句：设置页的探测提示、做不到的那几件、模型对不上。模型名是它报的，原样显示。 */
export const AGY_DRIVER = defineMessages(
  {
    probeHint: "请从 https://antigravity.google/download 安装 Antigravity CLI，确保 agy 在 PATH 中，并在原生 CLI 完成登录。",
    noFork: "Antigravity 公开接口尚未提供会话分叉",
    closed: "Antigravity 会话已关闭",
    textOnly: "Antigravity stream-json 当前只接受文本",
    busy: "Antigravity 仍有一轮正在运行",
    stopForTrust: "请先停止当前轮，再切换 Antigravity 权限",
    stopForModel: "请先停止当前轮，再切换 Antigravity 模型",
    effortInModel: "请从 Antigravity 原生模型列表选择带强度的模型",
    noModel: (model: string) => `Antigravity 模型列表中没有 ${model}`,
  },
  {
    probeHint: "Install the Antigravity CLI from https://antigravity.google/download, make sure agy is on PATH, and sign in with the native CLI.",
    noFork: "Antigravity's public interface doesn't offer forking a thread yet",
    closed: "The Antigravity thread is closed",
    textOnly: "Antigravity stream-json only accepts text for now",
    busy: "Antigravity still has a turn running",
    stopForTrust: "Stop the current turn first, then change Antigravity's permissions",
    stopForModel: "Stop the current turn first, then switch Antigravity's model",
    effortInModel: "Pick a model that includes the reasoning level from Antigravity's native model list",
    noModel: (model) => `Antigravity's model list has no ${model}`,
  },
)
