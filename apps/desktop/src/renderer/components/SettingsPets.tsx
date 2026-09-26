import { useMemo } from "react"
import type { EngineInfo } from "@omni/protocol"
import type { PetKit, Settings } from "../../shared/settings.js"
import { FireSection } from "./SettingsPetsFire.js"
import { petRoster, type PetSlot } from "../pet-roster.js"
import { entryOf } from "../pet-entry.js"
import type { PetShape } from "../pets.js"
import { Field, Group, Toggle } from "./SettingsBits.js"

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
  const roster = useMemo(() => petRoster(engines, ""), [engines])
  const kit = settings.petKit
  const patch = (next: Partial<PetKit>): void => {
    onPatch({ petKit: { ...kit, ...next } })
  }
  return (
    <>
      <Group title="显示" {...showHint(roster, kit.hidden)}>
        {/* 主开关在这一页，不在「通用」：它和下面几项是同一件事的粗细两档，
            分在两页的话，关掉之后下面这些还亮着，读起来像是它们仍然生效 */}
        <Field
          label="桌宠"
          hint="蹲在输入框上沿的那几只，一家引擎一只。关掉是整块不渲染，不是藏起来"
          more="能拖能扔，松手它自己回窝。"
        >
          <Toggle
            label="桌宠"
            on={settings.pets}
            onChange={(pets) => {
              onPatch({ pets })
            }}
          />
        </Field>
        {roster.map((slot) => (
          <Field key={slot.key} label={slot.label} tag={slotHint(slot)}>
            <Toggle
              label={slot.label}
              on={!kit.hidden.includes(slot.key)}
              disabled={!settings.pets}
              hint={settings.pets ? undefined : "桌宠整块关着，先把上面那个打开"}
              onChange={(on) => {
                patch({ hidden: toggleKey(kit.hidden, slot.key, on) })
              }}
            />
          </Field>
        ))}
      </Group>
      <FireSection settings={settings} patch={patch} />
      <Group title="出场" hint="开应用、或者换一家引擎的时候，那只按自己的物性登场。" more={ENTRY_NOTE}>
        <Field
          label="播放出场动画"
          hint="关掉之后换引擎是直接换人。系统「减少动效」开着时这一项自动失效，不用你来关"
        >
          <Toggle
            label="播放出场动画"
            on={kit.entry}
            disabled={!settings.pets}
            hint={settings.pets ? undefined : "桌宠整块关着，先把上面那个打开"}
            onChange={(entry) => {
              patch({ entry })
            }}
          />
        </Field>
      </Group>
    </>
  )
}

const ENTRY_NOTE =
  "不是「啪」地出现：史莱姆砸下来，落地摊成一滩再弹回原形；" +
  "鲸先炸一圈水花再划弧跃出来。没见过的那一家只是淡进来——它连出场都不编花样，而这本身是个信号。"

const SHAPE: Readonly<Record<PetShape, string>> = {
  slime: "史莱姆",
  crab: "螃蟹",
  "dsh-mark": "鲸",
}

const ENTRY: Readonly<Record<ReturnType<typeof entryOf>, string>> = {
  drop: "砸下来",
  chute: "降落伞",
  splash: "跃出水面",
  fade: "淡入",
}

function slotHint(slot: PetSlot): string {
  return `${SHAPE[slot.look.shape]} · ${ENTRY[entryOf(slot.look)]}`
}

/**
 * 这一组下面那句话。**它得随着勾选实时变**——
 * 「只留一只」那条规则不写在这儿的话，用户关到只剩一只时会以为自己关坏了。
 */
function showHint(roster: readonly PetSlot[], hidden: readonly string[]): { hint: string; more: string } {
  const kept = roster.filter((slot) => !hidden.includes(slot.key)).length
  const why = "它们不是装饰——站位说的是「谁在答」：当前引擎那只亮着，其余压暗留在队里。"
  if (kept > 1) {
    return { hint: `现在留着 ${String(kept)} 只；当前引擎那只亮着，其余压暗留在队里。`, more: `${why}当前这家藏不掉：只要这一轮归它，它就得在场。` }
  }
  return {
    hint: "只留一只时，台面上永远是当前引擎那只。",
    more: `${why}不管勾的是哪一个——「只留一只」要的是「只看正在答的那个」。`,
  }
}

/** 黑名单的增删。**存的是藏起来的那几只**，理由见 `shared/settings.ts` 的 `PetKit`。 */
function toggleKey(hidden: readonly string[], key: string, on: boolean): readonly string[] {
  return on ? hidden.filter((k) => k !== key) : [...new Set([...hidden, key])]
}
