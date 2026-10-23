import type { BrassMode, PetKit, Settings, TrajMode } from "../../shared/settings.js"
import { Field, Group, Segmented, Toggle } from "./SettingsBits.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { PETS_FIRE } from "./SettingsPetsFire.messages.js"

type Text = (typeof PETS_FIRE)[Locale]

const TRAJ: readonly TrajMode[] = ["tape", "shell"]

/**
 * 「桌宠 → 开火」那一组。
 *
 * 从 `SettingsPets.tsx` 拆出来是行数闸门逼的，但边界也顺：那边回答
 * 「台面上站着谁」，这边回答「它在干什么」——而这一组里每一项都要
 * 交代**它编码的是哪个真实信号**，那些话本来就长。
 *
 * ## 这一组里哪些能调、哪些不能，判据只有一条
 *
 * **它改不改「打不打得掉」。** 射速恒等于流速，所以密度、难度、伤害一个都不给调；
 * 而弹壳、打靶不参与任何判定，它们只是同一件事的另一种读法，所以可以调。
 * 这条判据写在这儿，是因为下一个想往这一组里加东西的人第一眼就该看见它。
 */
export function FireSection({
  settings,
  patch,
}: {
  settings: Settings
  patch: (next: Partial<PetKit>) => void
}): React.JSX.Element {
  const m = useMessages(PETS_FIRE)
  const kit = settings.petKit
  const off = !settings.pets || !kit.fire
  return (
    <Group title={m.title} hint={m.hint} more={m.fireNote}>
      <Field
        label={m.fire}
        hint={m.fireHint}
      >
        <Toggle
          label={m.fire}
          on={kit.fire}
          disabled={!settings.pets}
          hint={settings.pets ? undefined : m.petsOff}
          onChange={(fire) => {
            patch({ fire })
          }}
        />
      </Field>
      <Field label={m.traj} hint={m.trajHint} more={m.trajMore}>
        <Segmented<TrajMode>
          options={TRAJ.map((id) => ({ id, label: m.trajMode[id] }))}
          value={kit.traj}
          disabled={off}
          onPick={(traj) => {
            patch({ traj })
          }}
        />
      </Field>
      <Field label={m.brass} hint={m.brassHint} more={m.brassMore}>
        <Segmented<BrassMode>
          options={brassOptions(kit.traj, m)}
          value={kit.brass}
          disabled={off}
          onPick={(brass) => {
            patch({ brass })
          }}
        />
      </Field>
      <Field label={m.foes} hint={m.foesHint} more={m.foeMore}>
        <Toggle
          label={m.foes}
          on={kit.foes}
          disabled={off || kit.range}
          hint={why(m, settings.pets, kit.fire, kit.range)}
          onChange={(foes) => {
            patch({ foes })
          }}
        />
      </Field>
      <Field label={m.range} hint={m.rangeHint} more={m.rangeMore}>
        <Toggle
          label={m.rangeToggle}
          on={kit.range}
          disabled={off}
          hint={why(m, settings.pets, kit.fire)}
          onChange={(range) => {
            patch({ range })
          }}
        />
      </Field>
    </Group>
  )
}

/** 「抛壳」那一档下每一发本身就是一枚壳，「不抛」在那儿说不通——变灰并说清楚。 */
function brassOptions(traj: TrajMode, m: Text): readonly { id: BrassMode; label: string; off?: boolean; why?: string }[] {
  const shell = traj === "shell"
  return [
    {
      id: "off",
      label: m.brassOff,
      ...(shell ? { off: true, why: m.brassOffWhy } : {}),
    },
    { id: "eject", label: shell ? m.brassVanish : m.brassEject },
    { id: "pile", label: m.brassPile },
  ]
}

/** 变灰时必须说清楚为什么——一个点不动又不解释的开关是这套界面里最坏的东西。 */
function why(m: Text, pets: boolean, fire: boolean, range = false): string | undefined {
  if (!pets) return m.petsOff
  if (!fire) return m.fireOff
  return range ? m.rangeOn : undefined
}
