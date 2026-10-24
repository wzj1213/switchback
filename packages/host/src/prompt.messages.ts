import { defineMessages } from "@switchback/i18n"

/** 这一家收不下这句话里的东西时说的话。 */
export const PROMPT = defineMessages(
  {
    noAttachments: (engine: string) => `${engine} 不支持附件；附件仍在输入区，请移除或换一个引擎`,
    noImages: (engine: string) => `排着的话里带着图片，${engine} 不收图片；这一轮跑完会照常发出，或者取回去掉图片再插`,
  },
  {
    noAttachments: (engine) => `${engine} doesn't support attachments. They're still in the input; remove them or switch engines`,
    noImages: (engine) =>
      `The queued message has images, and ${engine} doesn't accept images. It'll be sent as usual when this turn ends, or take it back and remove the images to insert it now`,
  },
)
