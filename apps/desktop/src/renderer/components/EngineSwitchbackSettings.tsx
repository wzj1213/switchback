import type { EngineAccount } from "@switchback/protocol"
import { withEngineEnabled } from "../../shared/engine-access.js"
import { dshProfileConfirmed, type Settings } from "../../shared/settings.js"
import type { EngineSettingItem, EngineSettingState } from "../engine-settings-model.js"
import { Field, Group, Toggle } from "./SettingsBits.js"

/**
 * 「在 Switchback 中」——**这一组里的每一件事都是 Switchback 自己的**。
 *
 * ## 为什么这里能有开关，而下面「原生配置」那一组只能指路
 *
 * 判据是那句总纲：**这件事是引擎自己把它当功能暴露出来的，还是 Switchback 拿它的零件
 * 替它攒出来的？** 「这家出不出现在 Switchback 的引擎选择器里」「新会话默认用哪家」
 * 完全是 Switchback 自己的界面状态，和引擎的行为一点关系都没有——所以它们是开关。
 * 而「关掉这家的某个工具」「替它改一条环境变量」是替引擎改它自己的行为，
 * 一律不做，哪怕零件够得着。
 *
 * ## 接入开关与 DSH 那条确认是两件事
 *
 * 「我不用这家」和「这家没配好」压成一个开关之后，用户关掉一家再回来看，
 * 就再也说不清自己当初关它是因为什么。所以并排两条，各说各的。
 */
export function EngineSwitchbackSettings({
  item,
  state,
  settings,
  account,
  locked,
  onPatch,
}: {
  item: EngineSettingItem
  state: EngineSettingState
  settings: Settings
  account: EngineAccount | undefined
  /**
   * 这是**最后一家还开着的**。
   *
   * 全关掉的话新会话一条都开不起来，而界面上不会有任何地方说明为什么。
   * 挡在这儿而不是在读取偏好时悄悄纠正：「我把它们全关了，Switchback 自作主张
   * 又打开一家」比一个点不动的开关更让人迷惑。
   */
  locked: boolean
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  const isDefault = settings.defaultEngine === item.id
  const off = settings.disabledEngines.includes(item.id)
  const ready = item.id !== "dsh" || dshProfileConfirmed(settings.dsh)
  return (
    <Group title="在 Switchback 中" hint="这一组只改 Switchback 自己的行为；引擎那边一个字节都不动。">
      <Field
        label="接入"
        hint={
          off
            ? "关着：不探测它、也不出现在引擎选择器里。你在终端里跑这家一切照旧。"
            : "开着：Switchback 启动时会探它一次，它出现在新会话的引擎选择器里。关掉能省下那次探测。"
        }
      >
        <Toggle
          label={`接入 ${item.label}`}
          on={!off}
          disabled={locked}
          hint={locked ? "至少留一家：全关掉之后新会话一条都开不起来" : undefined}
          onChange={(on) => {
            // **一次 patch 把两件事一起写**。分两次发的话，两条 IPC 各自回一份合并结果，
            // 后回来的那份可能是先发那次的——界面会闪回旧值
            onPatch({
              // 关掉**不擦** `dsh.confirmedProfiles`：那记的是另一件事（它那边配好了没有），
              // 擦了的话再打开时用户得重新确认一次，而他什么都没改过
              disabledEngines: withEngineEnabled(settings.disabledEngines, item.id, on),
              // 钉死的那一家被关掉时，「新会话默认」一并退回「跟上次」：留着它指向一家
              // 不在清单里的引擎，新会话会静默落回别处，而设置页还写着它是默认
              ...(!on && isDefault ? { defaultEngine: "" } : {}),
            })
          }}
        />
      </Field>
      {item.id === "dsh" ? (
        <Field
          label="原生配置就绪"
          hint={`确认 ${settings.dsh.profile} 已在 DSH Web 配好 Provider、模型与凭证。ACP 的握手不公开凭证是否就绪，所以只能由你替它作证；确认按 profile 分开记。`}
        >
          <Toggle
            label="DSH 原生配置就绪"
            on={ready}
            disabled={off}
            hint={off ? "先把上面的接入打开" : undefined}
            onChange={(on) => {
              const confirmed = new Set(settings.dsh.confirmedProfiles)
              if (on) confirmed.add(settings.dsh.profile)
              else confirmed.delete(settings.dsh.profile)
              onPatch({ dsh: { ...settings.dsh, confirmedProfiles: [...confirmed] } })
            }}
          />
        </Field>
      ) : null}
      <Field label="新会话默认用这家" hint="钉死这家，或者继续跟随你上一次实际开工用的引擎。">
        <Toggle
          label={`新会话默认用 ${item.label}`}
          on={isDefault}
          disabled={off || !ready}
          hint={off || !ready ? "这家还没接入" : undefined}
          onChange={(on) => {
            onPatch({ defaultEngine: on ? item.id : "" })
          }}
        />
      </Field>
      {/* 状态那两个字已经在这一页抬头的徽章上（`eng-status`），这一行只摆它探到的实情，不再右边再写一遍 */}
      <Field label="运行状态" hint={state.hint}>
        {null}
      </Field>
      <Field label="账号" hint={accountHint(account)}>
        <span className="eng-readout">{account?.label ?? "未报告"}</span>
      </Field>
    </Group>
  )
}

/** 「这家没报」和「你没登录」是两回事。**说不准的时候要说自己说不准。** */
function accountHint(account: EngineAccount | undefined): string {
  if (account === undefined) return "这家没有向 Switchback 报告账号；这不等于未登录。"
  return account.plan === undefined ? "由引擎自己报告" : `由引擎自己报告 · ${account.plan}`
}
