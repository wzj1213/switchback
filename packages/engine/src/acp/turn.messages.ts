import { defineMessages } from "@switchback/i18n"

/** 压缩、插话做不了时的人话，以及压缩成功那一条。 */
export const ACP_TURN = defineMessages(
  {
    what: { compact: "压缩上下文", steer: "中途插话", attach: "带附件插话" },
    unsupported: (id: string, what: string) => `${id} 不支持${what}。这不是故障——它的适配器没提供这个方法。`,
    noSessionCompact: "会话还没建立，压缩不了",
    noSessionSteer: "会话还没建立，插不进去",
    compacted: "上下文已压缩。",
  },
  {
    what: { compact: "compacting context", steer: "steering mid-turn", attach: "steering with attachments" },
    unsupported: (id, what) => `${id} doesn't support ${what}. Nothing is broken; its adapter just doesn't provide this method.`,
    noSessionCompact: "The thread hasn't started yet, so it can't be compacted",
    noSessionSteer: "The thread hasn't started yet, so nothing can be added to it",
    compacted: "Context compacted.",
  },
)
