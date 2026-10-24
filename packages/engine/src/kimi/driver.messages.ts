import { defineMessages } from "@switchback/i18n"

/** 开一条 Kimi 会话时可能被拒的几种情况。路径原样显示。 */
export const KIMI_DRIVER = defineMessages(
  {
    tailOnly: "Kimi Web 只能从会话末尾分叉，不能从更早的一轮分叉",
    wrongCwd: (owner: string, cwd: string) => `Kimi 会话属于 ${owner}，不能当成 ${cwd} 的会话续跑`,
    busy: "这条 Kimi 会话正在另一个界面里运行，请等它停下后再接入 Switchback",
    noModel: "Kimi 没有可用的默认模型；请先在 Kimi Code 里完成登录和模型配置",
    inFlight: "这条 Kimi 会话仍有一轮在运行，暂时不能接入 Switchback",
  },
  {
    tailOnly: "Kimi Web can only fork from the end of a thread, not from an earlier turn",
    wrongCwd: (owner, cwd) => `This Kimi thread belongs to ${owner}, so it can't be resumed as a thread in ${cwd}`,
    busy: "This Kimi thread is running in another interface. Wait for it to stop, then open it in Switchback",
    noModel: "Kimi has no default model. Sign in and set up a model in Kimi Code first",
    inFlight: "This Kimi thread still has a turn running, so Switchback can't open it yet",
  },
)
