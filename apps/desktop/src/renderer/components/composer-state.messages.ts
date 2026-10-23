import { defineMessages } from "@switchback/i18n"

/** 附件发不出去时，输入框说的那一句。 */
export const COMPOSER_STATE = defineMessages(
  {
    aside: "侧问不支持图片附件；图片已保留，请移除或退出侧问后再发",
    pending: "请先完成引擎切换，再确认新引擎能否接收这些附件；附件会保留",
    unsupported: "当前引擎或模型不支持图片附件；附件已保留，请移除或切换后再发",
  },
  {
    aside: "Side questions can't carry images. They're kept; remove them or leave the side question before sending.",
    pending: "Finish switching engines first, then check whether the new engine accepts these attachments. They're kept.",
    unsupported: "This engine or model doesn't accept images. They're kept; remove them or switch before sending.",
  },
)
