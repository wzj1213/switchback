import { defineMessages } from "@switchback/i18n"

/** 没连上时，那一下发不出去。 */
export const USE_REMOTE = defineMessages(
  { notSent: "现在没连上 Switchback，这一下没有发出去。等连上再点一次。" },
  { notSent: "Not connected to Switchback right now, so this wasn't sent. Try again once it's connected." },
)
