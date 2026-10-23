import { defineMessages } from "@switchback/i18n"

/** 设置 → 桌宠 → 开火。 */
export const PETS_FIRE = defineMessages(
  {
    title: "开火",
    hint: "当前那只按引擎此刻吐字的速度往左打，每中一发，纸带上落一个它刚写出来的字。",
    fireNote:
      "流速是把模型写出来的字按字符种类估成 token（中文、英文、代码各按各的算），开火节奏跟着最近一秒多的读数走。" +
      "每一轮跑完，分界线上会写「首字 0.8 秒 · 34 tok/s」：生成量 ÷ 真在出字的时间，调工具的空档不算；" +
      "引擎报了生成量用真数，没报的带 ≈。打靶模式靶上那行是同一个数。" +
      "射速恒等于流速：没有任何一项设置能改快慢——一旦能改，画面上的快慢说的就是你的配置，" +
      "而不是引擎此刻的表现，那这套东西也就没有存在的理由了。系统「减少动效」开着时自动失效。",
    fire: "按 token 流速开火",
    fireHint: "只画在当前那只身上。没有输出就没有火力——静默时它会把枪收起来",
    petsOff: "桌宠整块关着，先把上面那个打开",
    traj: "弹道",
    trajHint: "「打字机」每中一发在纸带上落一个字；「抛壳」每一发本身就是一枚壳。",
    trajMore:
      "「打字机」说的是产出：子弹不是打给谁的，是打出字来的。" +
      "「抛壳」没有纸带，每一发往斜后上方抛出去、走一条看得清的弧、落地弹两下——它说的是后坐力：这一下有多大劲、下一下隔多久来。" +
      "两档下有东西爬过来时都照旧朝它直射：让弹道决定打不打得着的话，" +
      "选了抛壳的人就永远清不掉那些东西，而那时候画面上的胜负说的是你的设置，不是引擎此刻的表现。",
    trajMode: { tape: "打字机", shell: "抛壳" },
    brass: "弹壳",
    brassHint: "壳落地之后留不留。三档都不改射速、不改伤害。",
    brassOff: "不抛",
    brassOffWhy: "「抛壳」那一档下每一发本身就是一枚壳，关掉它这一发就什么都没发生了",
    brassVanish: "落地就没",
    brassEject: "抛出去",
    brassPile: "堆着",
    brassMore:
      "「抛出去 / 落地就没」读的是节奏：连发时壳连成一串，一顿一顿时壳也一颗一颗地来。" +
      "「堆着」读的是在途——壳不消失、落地就停，堆多高就是这一轮吐了多少（吐出来了、还没结账的那一批），" +
      "结账那一下整堆扫平。这是这套东西里唯一一处把「在途」画出来的地方，而在途正是用量那道阶梯中间空掉的那一段。",
    foes: "让压力显形",
    foesHint: "上下文快满、卡住不吐字、流速很低时，左边会爬过来一些东西。",
    foeMore:
      "没有「密度」和「种类」可调——它们各自对着一个真实信号，可调就等于承认它们只是装饰。" +
      "史莱姆 ← 静默 · 蜂群 ← 低流速（血薄但一来一簇，射速跟不上只数）· 胖子 ← 上下文逼近上限（一路把纸带上的字吃掉）。",
    range: "打靶（评估用）",
    rangeHint: "台面上立一张靶，子弹改打它，弹着留洞不消失。开着时纸带和刷怪都让位",
    rangeToggle: "打靶",
    rangeMore:
      "节奏变成洞在时间上的疏密，后坐变成洞一路往上串，上下文变成靶心那圈有效区——" +
      "被它吃掉的那一圈不算命中，因为上下文变满本来就是真实的能力衰减。" +
      "它编码不了任何引擎信号（引擎不会没事去打靶），所以它是个评估台，不是产品状态。",
    fireOff: "要开火才有得打，先把上面那个打开",
    rangeOn: "打靶开着：那张靶要的是干净的弹着，被一群东西挡在中间就读不出散布了",
  },
  {
    title: "Firing",
    hint: "The current pet fires to the left at the rate the engine is writing; each hit drops one character it just wrote onto the tape.",
    fireNote:
      "The rate estimates tokens from the characters the model writes (Chinese, English, and code each counted their own way), and firing follows the reading from the last second or so. " +
      "After each turn, the divider shows “first token 0.8s · 34 tok/s”: tokens generated ÷ time spent actually writing, not counting tool gaps; " +
      "engines that report token counts get exact numbers, the rest are marked ≈. In target practice the line on the target is the same number. " +
      "Fire rate always equals the token rate, and no setting changes the speed: if one could, the speed on screen would describe your settings " +
      "instead of how the engine is doing right now, and the whole thing would have no reason to exist. It turns off automatically when the system's Reduce Motion is on.",
    fire: "Fire at the token rate",
    fireHint: "Drawn only on the current pet. No output, no fire: when it's quiet, it puts the gun away",
    petsOff: "Pets are off; turn on the switch above first",
    traj: "Trajectory",
    trajHint: "With “Typewriter”, each hit drops a character on the tape; with “Shells”, each shot is itself a shell.",
    trajMore:
      "“Typewriter” is about output: the bullets aren't aimed at anyone, they type out characters. " +
      "“Shells” has no tape: each shot is thrown up and back, follows a clear arc, and bounces twice on landing; it's about recoil, how hard each shot kicks and how long until the next. " +
      "In both modes, anything crawling in is still shot straight on: if the trajectory decided whether it could be hit, " +
      "anyone who chose shells could never clear them, and winning or losing on screen would describe your settings, not how the engine is doing.",
    trajMode: { tape: "Typewriter", shell: "Shells" },
    brass: "Casings",
    brassHint: "Whether casings stay after they land. None of the three changes fire rate or damage.",
    brassOff: "None",
    brassOffWhy: "With “Shells”, each shot is itself a casing; turning casings off would mean nothing happens per shot",
    brassVanish: "Vanish on landing",
    brassEject: "Ejected",
    brassPile: "Pile up",
    brassMore:
      "“Ejected” and “Vanish on landing” read rhythm: in bursts the casings form a stream, in stops they come one at a time. " +
      "“Pile up” reads what's in flight: casings stay where they land, and the pile's height is how much this turn has written (written but not billed yet); " +
      "the pile is swept flat when it's billed. This is the only place the setup shows what's in flight, which is exactly the gap in the middle of the usage ladder.",
    foes: "Show pressure",
    foesHint: "When context is nearly full, output stalls, or the rate is very low, things crawl in from the left.",
    foeMore:
      "There's no “density” or “variety” to tune: each answers to a real signal, and making them tunable would admit they're just decoration. " +
      "Slime ← silence · swarm ← low rate (weak but in clusters, too many for the fire rate) · fatty ← context nearing its limit (eats the characters on the tape as it goes).",
    range: "Target practice (for evaluation)",
    rangeHint: "Puts up a target for the bullets instead; the holes stay. While it's on, the tape and the crawlers step aside",
    rangeToggle: "Target practice",
    rangeMore:
      "Rhythm becomes how the holes are spaced in time, recoil becomes holes climbing upward, and context becomes the effective ring around the bullseye. " +
      "Hits in the part it has eaten don't count, because a filling context really is a loss of capability. " +
      "It can't encode any engine signal (engines don't practice on targets), so it's an evaluation bench, not product state.",
    fireOff: "Firing has to be on for this; turn on the switch above first",
    rangeOn: "Target practice is on: the target needs clean hits, and with things in the way the spread can't be read",
  },
)
