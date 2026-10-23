import type { EngineAccount } from "@switchback/protocol"
import { withEngineEnabled } from "../../shared/engine-access.js"
import { dshProfileConfirmed, type Settings } from "../../shared/settings.js"
import type { EngineSettingItem, EngineSettingState } from "../engine-settings-model.js"
import { Field, Group, Toggle } from "./SettingsBits.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { ENGINE_SWITCHBACK } from "./EngineSwitchbackSettings.messages.js"

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
  const m = useMessages(ENGINE_SWITCHBACK)
  const isDefault = settings.defaultEngine === item.id
  const off = settings.disabledEngines.includes(item.id)
  const ready = item.id !== "dsh" || dshProfileConfirmed(settings.dsh)
  return (
    <Group title={m.title} hint={m.hint}>
      <Field
        label={m.connect}
        hint={off ? m.off : m.on}
      >
        <Toggle
          label={m.connectToggle(item.label)}
          on={!off}
          disabled={locked}
          hint={locked ? m.locked : undefined}
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
          label={m.dshReady}
          hint={m.dshReadyHint(settings.dsh.profile)}
        >
          <Toggle
            label={m.dshToggle}
            on={ready}
            disabled={off}
            hint={off ? m.dshOff : undefined}
            onChange={(on) => {
              const confirmed = new Set(settings.dsh.confirmedProfiles)
              if (on) confirmed.add(settings.dsh.profile)
              else confirmed.delete(settings.dsh.profile)
              onPatch({ dsh: { ...settings.dsh, confirmedProfiles: [...confirmed] } })
            }}
          />
        </Field>
      ) : null}
      <Field label={m.default} hint={m.defaultHint}>
        <Toggle
          label={m.defaultToggle(item.label)}
          on={isDefault}
          disabled={off || !ready}
          hint={off || !ready ? m.notConnected : undefined}
          onChange={(on) => {
            onPatch({ defaultEngine: on ? item.id : "" })
          }}
        />
      </Field>
      {/* 状态那两个字已经在这一页抬头的徽章上（`eng-status`），这一行只摆它探到的实情，不再右边再写一遍 */}
      <Field label={m.status} hint={state.hint}>
        {null}
      </Field>
      <Field label={m.account} hint={accountHint(account, m)}>
        <span className="eng-readout">{account?.label ?? m.notReported}</span>
      </Field>
    </Group>
  )
}

/** 「这家没报」和「你没登录」是两回事。**说不准的时候要说自己说不准。** */
function accountHint(account: EngineAccount | undefined, m: (typeof ENGINE_SWITCHBACK)[Locale]): string {
  if (account === undefined) return m.accountMissing
  return account.plan === undefined ? m.accountReported : m.accountPlan(account.plan)
}
