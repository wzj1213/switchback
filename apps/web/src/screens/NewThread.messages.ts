import { defineMessages } from "@switchback/i18n"

/** 在手机上开一条新会话。档位照原样显示 id，和页脚「远程上限」一致。 */
export const NEW_THREAD = defineMessages(
  {
    noProjects: "还没有可用的项目。到桌面上开第一条会话，这里就能接着开了。",
    loading: "正在取项目清单…",
    project: "在哪个项目",
    engine: "用哪家引擎",
    note: (trust: string) => `开出来是「${trust}」档——这是远程的上限，改档位要去桌面上。`,
    waiting: "等重连…",
    create: "开一条",
    back: "返回列表",
    title: "新会话",
  },
  {
    noProjects: "No projects yet. Start the first thread on the desktop, then you can start more here.",
    loading: "Loading projects…",
    project: "Which project",
    engine: "Which engine",
    note: (trust) => `It starts at “${trust}”, the remote limit. To change the tier, use the desktop.`,
    waiting: "Waiting to reconnect…",
    create: "Start thread",
    back: "Back to list",
    title: "New thread",
  },
)
