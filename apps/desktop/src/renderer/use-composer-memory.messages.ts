import { defineMessages } from "@switchback/i18n"

/** 草稿里的图片已经不在时的那一句。 */
export const COMPOSER_MEMORY = defineMessages(
  { missing: (n: number) => `上次没发出去的草稿里有 ${String(n)} 张图已经不在了，没能放回来` },
  {
    missing: (n) =>
      n === 1
        ? "An image from your unsent draft is gone and couldn't be restored"
        : `${String(n)} images from your unsent draft are gone and couldn't be restored`,
  },
)
