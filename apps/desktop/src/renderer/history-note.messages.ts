import { defineMessages } from "@switchback/i18n"

/** 回放出来的历史会话：输入框上先交代的那一句。 */
export const HISTORY_NOTE = defineMessages(
  {
    next: (name: string) => `历史会话：发出去由 ${name} 接着做。`,
    noHandle: (name: string) => `这条会话没留下 ${name} 的会话句柄，接不回原来的上下文——在下面换一家引擎接着做。`,
    gone: (name: string) => `引擎列表里已经没有 ${name}——在下面换一家接着做；直接发会先试着接回它。`,
    revive: (name: string) => `历史会话：直接发话，会先接回 ${name} 原来的会话。`,
  },
  {
    next: (name) => `Past thread: ${name} picks it up when you send.`,
    noHandle: (name) =>
      `This thread has no ${name} session handle left, so its earlier context can't come back. Switch to another engine below to continue.`,
    gone: (name) => `${name} is no longer in the engine list. Switch engines below, or send and Switchback tries to reconnect it first.`,
    revive: (name) => `Past thread: send a message and its original ${name} session reconnects first.`,
  },
)
