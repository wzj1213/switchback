import { defineMessages } from "@switchback/i18n"

/** 点「重新探测」之后那一句。 */
export const RESCAN = defineMessages(
  {
    join: (names: readonly string[]) => names.join("、"),
    ready: (names: string) => `认出了 ${names}`,
    lost: (names: string) => `${names} 现在用不了了`,
    none: "查过了，没有变化——装的还是那几家",
    restart: (names: string) => `${names} 改过了，但有会话正在用它——关掉那些会话后再点一次，或者重启 Switchback。`,
    whole: (parts: readonly string[], tail: string) => `${parts.join("；")}。${tail}`,
  },
  {
    join: (names) => names.join(", "),
    ready: (names) => `Found ${names}`,
    lost: (names) => `${names} can't be used now`,
    none: "Checked: nothing changed, the same engines are installed",
    restart: (names) => `${names} changed, but a thread is using it. Close those threads and click again, or restart Switchback.`,
    whole: (parts, tail) => `${parts.join("; ")}.${tail === "" ? "" : ` ${tail}`}`,
  },
)
