import { defineMessages } from "@switchback/i18n"

/** 各家配置文件那一行的一句话：这份管什么。**不解释格式**——那是引擎自己文档的事。 */
export const ENGINE_DOORS = defineMessages(
  {
    claude: "权限、钩子、模型默认值",
    codex: "沙箱、审批策略、模型",
    kimi: "思考档、循环控制、后台任务",
    grokManaged: "由 Grok 自己维护，一般不手改",
    grokUser: "你自己的那份",
    dshSettings: "模型、权限与通用偏好",
    dshProfile: (profile: string) => `当前 ${profile} profile 的补丁；增删请走 dsh plugin`,
    project: "只对这个项目生效",
  },
  {
    claude: "Permissions, hooks, model defaults",
    codex: "Sandbox, approval policy, model",
    kimi: "Thinking level, loop control, background tasks",
    grokManaged: "Maintained by Grok itself; usually not edited by hand",
    grokUser: "Your own copy",
    dshSettings: "Models, permissions, and general preferences",
    dshProfile: (profile) => `Patch for the current ${profile} profile; add or remove plugins with dsh plugin`,
    project: "Applies to this project only",
  },
)
