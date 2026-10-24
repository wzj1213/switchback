import { defineMessages } from "@switchback/i18n"

/** 开会话撞上「要先登录」时那一句。它自己的原话与登录方式的名字原样放进去。 */
export const ACP_AUTH = defineMessages(
  {
    none: "它没有报任何登录方式，只能照它自己的文档在终端里登录",
    offered: (names: readonly string[]) => `它提供的登录方式：${names.join("、")}`,
    required: (who: string, said: string, offered: string) =>
      `${who} 要先登录才能开会话（它说：${said}）。${offered}。到 设置 → 安装与接入，在它那张卡上点「试接」再挑一种登录方式，登完再开一次。`,
  },
  {
    none: "It reports no sign-in methods, so sign in from a terminal following its own docs",
    offered: (names) => `Sign-in methods it offers: ${names.join(", ")}`,
    required: (who, said, offered) =>
      `${who} needs you to sign in before it can open a thread (it said: ${said}). ${offered}. Go to Settings → Install & connect, click “Try” on its card, pick a sign-in method, then open the thread again.`,
  },
)
