import type { BrassMode, PetKit, Settings, TrajMode } from "../../shared/settings.js"
import { Field, Group, Segmented, Toggle } from "./SettingsBits.js"

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
  const kit = settings.petKit
  const off = !settings.pets || !kit.fire
  return (
    <Group title="开火" hint="当前那只按引擎此刻吐字的速度往左打，每中一发，纸带上落一个它刚写出来的字。" more={FIRE_NOTE}>
      <Field
        label="按 token 流速开火"
        hint="只画在当前那只身上。没有输出就没有火力——静默时它会把枪收起来"
      >
        <Toggle
          label="按 token 流速开火"
          on={kit.fire}
          disabled={!settings.pets}
          hint={settings.pets ? undefined : "桌宠整块关着，先把上面那个打开"}
          onChange={(fire) => {
            patch({ fire })
          }}
        />
      </Field>
      <Field label="弹道" hint="「打字机」每中一发在纸带上落一个字；「抛壳」每一发本身就是一枚壳。" more={TRAJ_MORE}>
        <Segmented<TrajMode>
          options={TRAJ}
          value={kit.traj}
          disabled={off}
          onPick={(traj) => {
            patch({ traj })
          }}
        />
      </Field>
      <Field label="弹壳" hint="壳落地之后留不留。三档都不改射速、不改伤害。" more={BRASS_MORE}>
        <Segmented<BrassMode>
          options={brassOptions(kit.traj)}
          value={kit.brass}
          disabled={off}
          onPick={(brass) => {
            patch({ brass })
          }}
        />
      </Field>
      <Field label="让压力显形" hint="上下文快满、卡住不吐字、流速很低时，左边会爬过来一些东西。" more={FOE_MORE}>
        <Toggle
          label="让压力显形"
          on={kit.foes}
          disabled={off || kit.range}
          hint={why(settings.pets, kit.fire, kit.range)}
          onChange={(foes) => {
            patch({ foes })
          }}
        />
      </Field>
      <Field label="打靶（评估用）" hint="台面上立一张靶，子弹改打它，弹着留洞不消失。开着时纸带和刷怪都让位" more={RANGE_MORE}>
        <Toggle
          label="打靶"
          on={kit.range}
          disabled={off}
          hint={why(settings.pets, kit.fire)}
          onChange={(range) => {
            patch({ range })
          }}
        />
      </Field>
    </Group>
  )
}

const FIRE_NOTE =
  "流速是把模型写出来的字按字符种类估成 token（中文、英文、代码各按各的算，引擎报了生成量就拿真数校准），" +
  "对话末尾那行状态里的「≈ 58 tok/s」就是它，口径和各家评测的输出速度一样：生成量 ÷ 真在出字的时间。" +
  "射速恒等于流速：没有任何一项设置能改快慢——一旦能改，画面上的快慢说的就是你的配置，" +
  "而不是引擎此刻的表现，那这套东西也就没有存在的理由了。系统「减少动效」开着时自动失效。"

const TRAJ: readonly { id: TrajMode; label: string }[] = [
  { id: "tape", label: "打字机" },
  { id: "shell", label: "抛壳" },
]

const TRAJ_MORE =
  "「打字机」说的是产出：子弹不是打给谁的，是打出字来的。" +
  "「抛壳」没有纸带，每一发往斜后上方抛出去、走一条看得清的弧、落地弹两下——它说的是后坐力：这一下有多大劲、下一下隔多久来。" +
  "两档下有东西爬过来时都照旧朝它直射：让弹道决定打不打得着的话，" +
  "选了抛壳的人就永远清不掉那些东西，而那时候画面上的胜负说的是你的设置，不是引擎此刻的表现。"

/** 「抛壳」那一档下每一发本身就是一枚壳，「不抛」在那儿说不通——变灰并说清楚。 */
function brassOptions(traj: TrajMode): readonly { id: BrassMode; label: string; off?: boolean; why?: string }[] {
  const shell = traj === "shell"
  return [
    {
      id: "off",
      label: "不抛",
      ...(shell ? { off: true, why: "「抛壳」那一档下每一发本身就是一枚壳，关掉它这一发就什么都没发生了" } : {}),
    },
    { id: "eject", label: shell ? "落地就没" : "抛出去" },
    { id: "pile", label: "堆着" },
  ]
}

const BRASS_MORE =
  "「抛出去 / 落地就没」读的是节奏：连发时壳连成一串，一顿一顿时壳也一颗一颗地来。" +
  "「堆着」读的是在途——壳不消失、落地就停，堆多高就是这一轮吐了多少（吐出来了、还没结账的那一批），" +
  "结账那一下整堆扫平。这是这套东西里唯一一处把「在途」画出来的地方，而在途正是用量那道阶梯中间空掉的那一段。"

const FOE_MORE =
  "没有「密度」和「种类」可调——它们各自对着一个真实信号，可调就等于承认它们只是装饰。" +
  "史莱姆 ← 静默 · 蜂群 ← 低流速（血薄但一来一簇，射速跟不上只数）· 胖子 ← 上下文逼近上限（一路把纸带上的字吃掉）。"

const RANGE_MORE =
  "节奏变成洞在时间上的疏密，后坐变成洞一路往上串，上下文变成靶心那圈有效区——" +
  "被它吃掉的那一圈不算命中，因为上下文变满本来就是真实的能力衰减。" +
  "它编码不了任何引擎信号（引擎不会没事去打靶），所以它是个评估台，不是产品状态。"

/** 变灰时必须说清楚为什么——一个点不动又不解释的开关是这套界面里最坏的东西。 */
function why(pets: boolean, fire: boolean, range = false): string | undefined {
  if (!pets) return "桌宠整块关着，先把上面那个打开"
  if (!fire) return "要开火才有得打，先把上面那个打开"
  return range ? "打靶开着：那张靶要的是干净的弹着，被一群东西挡在中间就读不出散布了" : undefined
}
