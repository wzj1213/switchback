import { defineMessages } from "@switchback/i18n"

/** 远程窗口没连上时，那一下发不出去。 */
export const REMOTE_BRIDGE = defineMessages(
  { notSent: "现在没连上那台机器，这一下没有发出去。等连上再点一次。" },
  { notSent: "Not connected to the host machine right now, so this wasn't sent. Try again once it's connected." },
)
