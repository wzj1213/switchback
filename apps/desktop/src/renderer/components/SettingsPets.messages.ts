import { count, defineMessages } from "@switchback/i18n"

/** 设置 → 桌宠：显示与出场。 */
export const SETTINGS_PETS = defineMessages(
  {
    show: "显示",
    pets: "桌宠",
    petsHint: "蹲在输入框上沿的那几只，一家引擎一只。关掉是整块不渲染，不是藏起来",
    petsMore: "能拖能扔，松手它自己回窝。",
    petsOff: "桌宠整块关着，先把上面那个打开",
    entry: "出场",
    entryHint: "开应用、或者换一家引擎的时候，那只按自己的物性登场。",
    play: "播放出场动画",
    playHint: "关掉之后换引擎是直接换人。系统「减少动效」开着时这一项自动失效，不用你来关",
    entryNote:
      "不是「啪」地出现：史莱姆砸下来，落地摊成一滩再弹回原形；" +
      "鲸先炸一圈水花再划弧跃出来。没见过的那一家只是淡进来——它连出场都不编花样，而这本身是个信号。",
    shape: { slime: "史莱姆", crab: "螃蟹", "dsh-mark": "鲸" },
    entryKind: { drop: "砸下来", chute: "降落伞", splash: "跃出水面", fade: "淡入" },
    why: "它们不是装饰——站位说的是「谁在答」：当前引擎那只亮着，其余压暗留在队里。",
    kept: (n: number) => `现在留着 ${String(n)} 只；当前引擎那只亮着，其余压暗留在队里。`,
    keptMore: (why: string) => `${why}当前这家藏不掉：只要这一轮归它，它就得在场。`,
    one: "只留一只时，台面上永远是当前引擎那只。",
    oneMore: (why: string) => `${why}不管勾的是哪一个——「只留一只」要的是「只看正在答的那个」。`,
  },
  {
    show: "Display",
    pets: "Pets",
    petsHint: "The little ones sitting on top of the input, one per engine. Turning them off removes them entirely rather than hiding them",
    petsMore: "You can drag and throw them; let go and they head back home.",
    petsOff: "Pets are off; turn on the switch above first",
    entry: "Entrance",
    entryHint: "When the app opens or you switch engines, that engine's pet makes an entrance in its own way.",
    play: "Play entrance animation",
    playHint: "When off, switching engines just swaps pets. With the system's Reduce Motion on, this turns off by itself",
    entryNote:
      "They don't just pop in: the slime drops down, splats flat, and bounces back; " +
      "the whale splashes up a ring of water and leaps out in an arc. An engine it hasn't met just fades in; it doesn't make up an entrance, and that itself is a signal.",
    shape: { slime: "Slime", crab: "Crab", "dsh-mark": "Whale" },
    entryKind: { drop: "Drops in", chute: "Parachute", splash: "Leaps out of the water", fade: "Fades in" },
    why: "They aren't decoration: where they stand says who's answering. The current engine's pet is lit; the rest wait dimmed in line. ",
    kept: (n) => `${count(n, "pet")} kept; the current engine's is lit and the rest wait dimmed in line.`,
    keptMore: (why) => `${why}The current engine's pet can't be hidden: as long as the turn is its, it has to be there.`,
    one: "With only one kept, it's always the current engine's pet on stage.",
    oneMore: (why) => `${why}Whichever one is checked, keeping one means seeing only the one that's answering.`,
  },
)
