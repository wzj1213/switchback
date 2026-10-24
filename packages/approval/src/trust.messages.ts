import type { Catalog } from "@switchback/i18n"

/** 档位挡下一个动作时的理由。会出现在审批卡上，拒绝时也回给引擎。（为什么不调 `defineMessages` 见 `redline.messages.ts`。） */
const ZH = {
  deny: {
    "read-only": "当前会话是只读档，不能写文件、执行命令或访问网络。如需继续请让用户升档",
    "auto-edit": "当前档位不允许该动作",
    full: "当前档位不允许该动作",
  },
  unknown: "Switchback 没认出这是什么动作（读 / 写 / 执行 / 联网都对不上），所以按最保守的一档处理",
  escalate: "该动作超出当前档位的自动放行范围，等待用户确认",
}

export const TRUST: Catalog<typeof ZH> = {
  "zh-CN": ZH,
  en: {
    deny: {
      "read-only": "This thread is read-only: it can't write files, run commands, or access the network. To continue, ask the user to raise the tier",
      "auto-edit": "The current tier doesn't allow this action",
      full: "The current tier doesn't allow this action",
    },
    unknown: "Switchback didn't recognize what kind of action this is (it's not a read, write, command, or network access), so it's treated at the most cautious tier",
    escalate: "This action is beyond what the current tier allows automatically, so it's waiting for the user's approval",
  },
}
