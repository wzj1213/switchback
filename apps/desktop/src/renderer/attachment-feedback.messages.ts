import { count, defineMessages } from "@switchback/i18n"

/**
 * 拖放与粘贴附件时的那几句话。一句话可能由几段拼起来（「已添加…；另有…未能读取」），
 * 所以 `lead` 是打头的说法、`follow` 是跟在后面的说法，`join` 管两段怎么接。
 */
export const ATTACHMENT_FEEDBACK = defineMessages(
  {
    dropAny: "松手添加文件",
    dropBoth: (images: number, refs: number) => `松手添加 ${String(images)} 张图片并引用 ${String(refs)} 个文件`,
    dropImages: (n: number) => `松手添加 ${String(n)} 张图片`,
    dropRefs: (n: number) => `松手引用 ${String(n)} 个文件`,
    addedBoth: (images: number, refs: number) => `已添加 ${String(images)} 张图片，并引用 ${String(refs)} 个文件`,
    addedImages: (n: number) => `已添加 ${String(n)} 张图片`,
    addedRefs: (n: number) => `已引用 ${String(n)} 个文件`,
    join: (text: string, follow: string) => `${text}；${follow}`,
    oversizedLead: (n: number, limit: string) => `未添加：${String(n)} 张图片超过 ${limit}`,
    oversizedFollow: (n: number, limit: string) => `另有 ${String(n)} 张图片超过 ${limit}，没有添加`,
    failedLead: (n: number) => `未添加：${String(n)} 个文件未能读取`,
    failedFollow: (n: number) => `另有 ${String(n)} 个文件未能读取`,
    duplicateLead: (n: number) => `没有重复添加：${String(n)} 个文件已经在待发送内容中`,
    duplicateFollow: (n: number) => `另有 ${String(n)} 个文件已经在待发送内容中，没有重复添加`,
    outside: (n: number) => `。其中 ${String(n)} 个在当前工作区外，已保留绝对路径；能否读取由引擎权限决定`,
    end: (text: string) => `${text}。`,
    unavailable: "文件入口暂时不可用，请重新打开 Switchback。",
  },
  {
    dropAny: "Drop to add files",
    dropBoth: (images, refs) => `Drop to add ${count(images, "image")} and reference ${count(refs, "file")}`,
    dropImages: (n) => `Drop to add ${count(n, "image")}`,
    dropRefs: (n) => `Drop to reference ${count(n, "file")}`,
    addedBoth: (images, refs) => `Added ${count(images, "image")} and referenced ${count(refs, "file")}`,
    addedImages: (n) => `Added ${count(n, "image")}`,
    addedRefs: (n) => `Referenced ${count(n, "file")}`,
    join: (text, follow) => `${text}; ${follow}`,
    oversizedLead: (n, limit) => `Not added: ${count(n, "image")} over ${limit}`,
    oversizedFollow: (n, limit) => `${count(n, "other image")} over ${limit} not added`,
    failedLead: (n) => `Not added: ${count(n, "file")} couldn't be read`,
    failedFollow: (n) => `${count(n, "other file")} couldn't be read`,
    duplicateLead: (n) => `Not added twice: ${count(n, "file")} already in your message`,
    duplicateFollow: (n) => `${count(n, "other file")} already in your message, not added twice`,
    outside: (n) =>
      `. ${String(n)} of them ${n === 1 ? "is" : "are"} outside this workspace, so the absolute path is kept; whether the engine can read it depends on its permissions`,
    end: (text) => `${text}.`,
    unavailable: "Files can't be added right now. Reopen Switchback.",
  },
)
