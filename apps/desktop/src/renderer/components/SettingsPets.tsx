import { useMemo } from "react"
import type { EngineInfo } from "@switchback/protocol"
import type { PetKit, Settings } from "../../shared/settings.js"
import { FireSection } from "./SettingsPetsFire.js"
import { petRoster, type PetSlot } from "../pet-roster.js"
import { entryOf } from "../pet-entry.js"
import type { PetShape } from "../pets.js"
import { Field, Group, Toggle } from "./SettingsBits.js"
import type { Locale } from "@switchback/i18n"
import { useLocale } from "../i18n.js"
import { SETTINGS_PETS } from "./SettingsPets.messages.js"

type Text = (typeof SETTINGS_PETS)[Locale]

/**
 * 「桌宠」那一页。
 *
 * ## 为什么值得单开一页，而不是在「通用」里加两行
 *
 * 那几只回答的是**「此刻是谁在答」**——和主题、字号不是一类东西。
 * 更实在的是：这一页里的每一项都要**说清楚它编码的是什么**
 *（站位＝谁在答、登场＝换了一家），而那些话在「通用」那种一行一项的
 * 节奏里写不下；写不下就会被压成一句「显示桌宠」，
 * 于是用户永远不知道自己关掉的是一个指示器还是一个装饰。
 */
export function PetsSection({
  settings,
  engines,
  onPatch,
}: {
  settings: Settings
  engines: readonly EngineInfo[]
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  // 用空的「当前引擎」算花名册：这里要的是**谁可能出现**，不是这一刻谁亮着。
  // 设置页没有当前会话，硬塞一个进来只会让这一页依赖一件它不该关心的事
  const locale = useLocale()
  const m = SETTINGS_PETS[locale]
  const roster = useMemo(() => petRoster(engines, "", locale), [engines, locale])
  const kit = settings.petKit
  const patch = (next: Partial<PetKit>): void => {
    onPatch({ petKit: { ...kit, ...next } })
  }
  return (
    <>
      <Group title={m.show} {...showHint(roster, kit.hidden, m)}>
        {/* 主开关在这一页，不在「通用」：它和下面几项是同一件事的粗细两档，
            分在两页的话，关掉之后下面这些还亮着，读起来像是它们仍然生效 */}
        <Field
          label={m.pets}
          hint={m.petsHint}
          more={m.petsMore}
        >
          <Toggle
            label={m.pets}
            on={settings.pets}
            onChange={(pets) => {
              onPatch({ pets })
            }}
          />
        </Field>
        {roster.map((slot) => (
          <Field key={slot.key} label={slot.label} tag={slotHint(slot, m)}>
            <Toggle
              label={slot.label}
              on={!kit.hidden.includes(slot.key)}
              disabled={!settings.pets}
              hint={settings.pets ? undefined : m.petsOff}
              onChange={(on) => {
                patch({ hidden: toggleKey(kit.hidden, slot.key, on) })
              }}
            />
          </Field>
        ))}
      </Group>
      <FireSection settings={settings} patch={patch} />
      <Group title={m.entry} hint={m.entryHint} more={m.entryNote}>
        <Field
          label={m.play}
          hint={m.playHint}
        >
          <Toggle
            label={m.play}
            on={kit.entry}
            disabled={!settings.pets}
            hint={settings.pets ? undefined : m.petsOff}
            onChange={(entry) => {
              patch({ entry })
            }}
          />
        </Field>
      </Group>
    </>
  )
}

function slotHint(slot: PetSlot, m: Text): string {
  const shape: Readonly<Record<PetShape, string>> = m.shape
  return `${shape[slot.look.shape]} · ${m.entryKind[entryOf(slot.look)]}`
}

/**
 * 这一组下面那句话。**它得随着勾选实时变**——
 * 「只留一只」那条规则不写在这儿的话，用户关到只剩一只时会以为自己关坏了。
 */
function showHint(roster: readonly PetSlot[], hidden: readonly string[], m: Text): { hint: string; more: string } {
  const kept = roster.filter((slot) => !hidden.includes(slot.key)).length
  if (kept > 1) return { hint: m.kept(kept), more: m.keptMore(m.why) }
  return { hint: m.one, more: m.oneMore(m.why) }
}

/** 黑名单的增删。**存的是藏起来的那几只**，理由见 `shared/settings.ts` 的 `PetKit`。 */
function toggleKey(hidden: readonly string[], key: string, on: boolean): readonly string[] {
  return on ? hidden.filter((k) => k !== key) : [...new Set([...hidden, key])]
}
