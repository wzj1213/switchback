import { defineMessages } from "@switchback/i18n"

/** 桌宠悬停时那一句。 */
export const PET_PARTS = defineMessages(
  { running: (who: string) => `${who} · 正在跑`, turn: (who: string) => `${who} · 这一轮归它` },
  { running: (who) => `${who} · running`, turn: (who) => `${who} · its turn` },
)
