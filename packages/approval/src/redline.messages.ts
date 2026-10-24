import type { Catalog } from "@switchback/i18n"
import type { RedlineId } from "./redline.js"

/**
 * 红线的说明（`describe`）与拒绝理由（`reason`）。理由会出现在审批卡上，拒绝时也原样回给引擎。
 *
 * 本包零运行时依赖，所以不调 `defineMessages`：直接写成 `Catalog` 字面量，
 * 中英两版照样由类型检查对齐（`import type` 编译后不留痕）。
 */
const ZH = {
  describe: {
    "unparseable-command": "命令含无法静态判定的结构，而且看起来会动东西",
    "credential-read": "读取凭据文件或钥匙串",
    "engine-settings-write": "修改引擎自身配置",
    "switchback-self-config": "修改本项目的 Switchback 状态",
    "rm-outside-worksite": "在工作区外递归删除",
    "write-outside-worksite": "工作区外写入",
    "exec-writes-outside-worksite": "命令看起来会写到工作区外",
    "write-unknown-target": "写操作但判不出目标路径",
    "git-push": "推送到远端",
    "git-destructive": "丢弃未提交改动或未跟踪文件",
    "global-install": "安装全局包",
    network: "网络访问",
  },
  reason: {
    "unparseable-command": "命令里有无法静态判定的结构，看不出它会动什么，需要人工确认",
    "credential-read": "拒绝访问凭据文件。如果任务确实需要某个密钥，请说明用途并让用户手工提供，不要直接读取凭据文件",
    "engine-settings-write": "该路径是引擎或 Switchback 自身的配置，改动会静默改变权限行为，必须人工确认",
    "switchback-self-config": ".switchback 目录保存本项目的审批记忆与会话状态，不能由 agent 自行修改",
    "rm-outside-worksite": "拒绝在工作区外递归删除。请把操作限制在当前工作区内",
    "write-outside-worksite": "目标路径不在当前工作区内。若确需修改，请说明理由；只读档下一律拒绝",
    "exec-writes-outside-worksite": "命令带有写入语义且目标疑似在工作区外，需要人工确认",
    "write-unknown-target": "无法从参数中判定写入目标，需要人工确认",
    "git-push": "推送到远端是对外可见的不可逆动作，必须人工确认",
    "git-destructive": "该命令会丢弃未提交改动或未跟踪文件，无法恢复，必须人工确认",
    "global-install": "全局安装会污染宿主环境，必须人工确认。优先考虑项目内依赖",
    network: "网络访问需要确认目标主机",
  },
} satisfies Record<"describe" | "reason", Record<RedlineId, string>>

export const REDLINE: Catalog<typeof ZH> = {
  "zh-CN": ZH,
  en: {
    describe: {
      "unparseable-command": "Command has structure that can't be analyzed statically, and looks like it changes things",
      "credential-read": "Reading credential files or the keychain",
      "engine-settings-write": "Changing an engine's own configuration",
      "switchback-self-config": "Changing this project's Switchback state",
      "rm-outside-worksite": "Recursive delete outside the workspace",
      "write-outside-worksite": "Writing outside the workspace",
      "exec-writes-outside-worksite": "Command looks like it writes outside the workspace",
      "write-unknown-target": "Write whose target path can't be determined",
      "git-push": "Pushing to a remote",
      "git-destructive": "Discarding uncommitted changes or untracked files",
      "global-install": "Installing a global package",
      network: "Network access",
    },
    reason: {
      "unparseable-command": "The command has structure that can't be analyzed statically, so it's unclear what it would change. It needs manual approval",
      "credential-read": "Access to credential files is denied. If the task really needs a secret, explain what it's for and have the user provide it by hand. Don't read credential files directly",
      "engine-settings-write": "This path is the engine's or Switchback's own configuration. Changing it would silently change permission behavior, so it needs manual approval",
      "switchback-self-config": "The .switchback folder holds this project's approval memory and thread state. The agent must not change it on its own",
      "rm-outside-worksite": "Recursive deletes outside the workspace are denied. Keep the operation inside the current workspace",
      "write-outside-worksite": "The target path is outside the current workspace. If the change is really needed, explain why. In read-only mode this is always denied",
      "exec-writes-outside-worksite": "The command writes, and its target seems to be outside the workspace. It needs manual approval",
      "write-unknown-target": "The write target can't be determined from the arguments. It needs manual approval",
      "git-push": "Pushing to a remote is visible to others and can't be undone, so it needs manual approval",
      "git-destructive": "This command discards uncommitted changes or untracked files, which can't be recovered, so it needs manual approval",
      "global-install": "A global install changes the host environment, so it needs manual approval. Prefer a project dependency",
      network: "Network access needs the target host confirmed",
    },
  },
}
