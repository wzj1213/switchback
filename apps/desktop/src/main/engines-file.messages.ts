import { defineMessages } from "@switchback/i18n"

/**
 * 往 `engines.json` 里写不进去的几种情况，以及第一次写进去的那份样板。
 * 样板的注释键在中文版叫 `_说明`、英文版叫 `_notes`——下划线开头的键一律当注释读。
 */
export const ENGINES_FILE_TEXT = defineMessages(
  {
    badJson: (file: string) => `${file} 现在不是合法的 JSON，Switchback 不敢往里写。请先自己打开修一下。`,
    notObject: (file: string) => `${file} 的最外层不是一个对象，Switchback 不敢往里写。`,
    taken: (file: string, name: string) => `${file} 里已经有一条叫 \`${name}\` 的了。换个名字，或者先自己去改那一条。`,
    vanished: (file: string, name: string) => `${file} 里没有 \`${name}\` 这一条了，可能刚被你手改过。重新打开这一页再试。`,
    gone: (file: string, name: string) => `${file} 里已经没有 \`${name}\` 了。`,
    notesKey: "_说明",
    notes: {
      what: "这里注册讲 ACP（Agent Client Protocol）的第三方引擎。",
      keys: "键是引擎 id，会以 acp: 前缀出现在界面上；值里的 command 是可执行文件。",
      easier: "更省事的接法：设置 → 安装与接入，从 ACP 注册表里点「接入」，或者指一个可执行文件让它自己回答。",
      rescan: "手改这个文件之后去 设置 → 安装与接入 点「重新探测」：新加的当场可用，改过或删掉的只要没有会话在用也当场生效。",
      inUse: "正在被会话用着的那几家要等那些会话关掉（或重启 Switchback）——它们还握着旧的那份。",
      example: "下面 example 那一条是样板，删掉它或改成你真正装了的适配器。",
    },
    exampleLabel: "示例（把这条删掉）",
  },
  {
    badJson: (file) => `${file} isn't valid JSON right now, so Switchback won't write to it. Open it and fix it first.`,
    notObject: (file) => `The top level of ${file} isn't an object, so Switchback won't write to it.`,
    taken: (file, name) => `${file} already has an entry named \`${name}\`. Pick another name, or edit that entry yourself first.`,
    vanished: (file, name) => `${file} no longer has \`${name}\`; you may have just edited it by hand. Reopen this page and try again.`,
    gone: (file, name) => `${file} no longer has \`${name}\`.`,
    notesKey: "_notes",
    notes: {
      what: "Third-party engines that speak ACP (Agent Client Protocol) are registered here.",
      keys: "Each key is an engine id, shown in the app with an acp: prefix; command is the executable.",
      easier: "The easier way: in Settings → Install & connect, click “Connect” on an entry from the ACP registry, or point to an executable and let it answer for itself.",
      rescan: "After editing this file by hand, click “Detect again” in Settings → Install & connect: new entries work right away, and changed or removed ones take effect at once if no thread is using them.",
      inUse: "Engines that threads are using wait until those threads close (or Switchback restarts); they still hold the old entry.",
      example: "The example entry below is a template: delete it or change it to an adapter you actually installed.",
    },
    exampleLabel: "Example (delete this entry)",
  },
)
