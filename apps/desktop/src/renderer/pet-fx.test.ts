import { describe, expect, it } from "vitest"
import { createFx, handOf, muzzleOf, resetFx, stepFx, tapeAt, type FxInput, type FxWorld } from "./pet-fx.js"
import { spawnFoes } from "./pet-foes.js"
import { spreadOf } from "./pet-range.js"
import type { Pet } from "./pets.js"

const pet: Pet = { x: 400, y: 120, vx: 0, vy: 0, spin: 0, mode: "rest" }

/** 固定随机源：这一层不含随机，所以测试完全确定。 */
const rand = (): number => 0.5

const input = (over: Partial<FxInput> = {}): FxInput => ({
  pet,
  shape: "slime",
  rate: 0,
  busyHands: false,
  // 默认「不在跑、上下文很空」＝**没有压力**，于是这些用例里一只怪都不会来，
  // 火力那几条才量得准。刷怪单独在下面那组里测
  running: false,
  ratio: 0,
  left: 0,
  // 台面：窝就在那只此刻站的地方，脚线就是它的脚线。**靶钉在这上面**——
  // 于是「不动它」时的读数和靶跟着手走的老版本完全一致，用例里量的还是同一件事
  field: { homeX: pet.x, ground: pet.y + 30 },
  // 成绩不参与任何物理，只是要印到靶上的一行字——这一组量的是物理
  pace: undefined,
  speed: undefined,
  nextChar: () => "字",
  foes: true,
  // 默认不抛壳、打字机、不打靶：这一组量的是火力，多一样在动就多一条会晃的判据
  brass: "off",
  traj: "tape",
  range: false,
  rand,
  ...over,
})

/** 跑 `secs` 秒，数一数打到纸带上的有几发（每一发取一个字）。 */
function shotsAt(rate: number, secs: number): number {
  let n = 0
  run(createFx(), secs, {
    rate,
    nextChar: () => {
      n += 1
      return "字"
    },
  })
  return n
}

/**
 * 跑 `secs` 秒。**原地改**，返回的就是传进来那个世界——
 * `stepFx` 本来就是这样（见它的注释）。要分支就各起一个世界，别从同一个分叉。
 */
function run(w: FxWorld, secs: number, over: Partial<FxInput> = {}): FxWorld {
  for (let t = 0; t < secs; t += 1 / 60) stepFx(w, 1 / 60, input(over))
  return w
}

describe("stepFx", () => {
  it("零流速不开火，也不留下任何字", () => {
    const w = run(createFx(), 3)
    expect(w.bullets).toHaveLength(0)
    expect(w.tape).toHaveLength(0)
  })

  it("有流速就抽枪、开火、在纸带上留字", () => {
    const w = run(createFx(), 3, { rate: 120 })
    expect(w.gun.arm).toBeGreaterThan(0.9)
    expect(w.tape.length).toBeGreaterThan(0)
  })

  it("火力恒等于流速：流速翻倍，打出去的发数也翻倍", () => {
    // 比的是**打了多少发**（每出一发取一个字），不是纸带上剩几个字：
    // 纸带的漂速也跟着流速走，所以它长度恒定——快慢体现在它走得多快
    const slow = shotsAt(40, 4)
    const fast = shotsAt(80, 4)
    expect(fast / Math.max(1, slow)).toBeGreaterThan(1.7)
    expect(fast / Math.max(1, slow)).toBeLessThan(2.3)
  })

  it("纸带是一条排得开的字，不是堆在一个点上的一团", () => {
    const w = run(createFx(), 4, { rate: 190 })
    const xs = w.tape.map((g) => g.x).sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(6)
    // 相邻两个字之间总得有一个字宽，否则读起来就是一团墨
    for (let i = 1; i < xs.length; i++) {
      expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeGreaterThan(6)
    }
  })

  it("先抽枪再开打——抽枪那一拍里一发都不出", () => {
    const w = createFx()
    stepFx(w, 1 / 60, input({ rate: 200 }))
    expect(w.bullets).toHaveLength(0)
    expect(w.gun.arm).toBeLessThan(0.55)
  })

  it("手里要换别的东西时立刻停火并收枪", () => {
    const w = run(createFx(), 3, { rate: 120 })
    const drawn = w.gun.arm // 先记下来：run 是原地改的，w 就是同一个世界
    run(w, 1.5, { rate: 120, busyHands: true })
    expect(w.gun.arm).toBeLessThan(drawn)
    expect(w.bullets).toHaveLength(0)
  })

  it("静默之后纸带会清空——「不动了」这一刻必须到得了", () => {
    const shot = run(createFx(), 3, { rate: 120 })
    expect(shot.tape.length).toBeGreaterThan(0)
    const quiet = run(shot, 12)
    expect(quiet.tape).toHaveLength(0)
    expect(quiet.moving).toBe(false)
  })

  it("巨大的 dt 不会一帧发散——切后台再回来是常态", () => {
    const w = createFx()
    for (let i = 0; i < 200; i++) stepFx(w, 4, input({ rate: 200 }))
    for (const v of [w.gun.x, w.gun.y, w.gun.ang, w.gun.kick, w.acc]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it("落下的是模型写出来的字，按到手的顺序——不是一串写死的字轮着用", () => {
    const source = "分页那段和订阅方式几乎一样可以直接照搬".repeat(20)
    let at = 0
    const w = run(createFx(), 3, {
      rate: 120,
      nextChar: () => source[at++] ?? "·",
    })
    const chars = w.tape.map((g) => g.ch).join("")
    expect(chars.length).toBeGreaterThan(3)
    expect(source.includes(chars)).toBe(true)
  })

  it("收工之后纸带一秒内淡干净，不留零散的字", () => {
    const w = run(createFx(), 2, { rate: 120, running: true })
    expect(w.tape.length).toBeGreaterThan(0)
    run(w, 1.2, { rate: 0, running: false })
    expect(w.tape).toHaveLength(0)
  })
})

describe("几何", () => {
  it("手在身子左沿外面一点，枪口再从手里往外探", () => {
    const hand = handOf(pet, "slime")
    // **在左沿外面**：画布压在桌宠底下，手搁在身体内侧的话整把枪都被盖住
    expect(hand.x).toBeLessThan(pet.x)
    expect(pet.x - hand.x).toBeLessThan(4)
    expect(hand.y).toBeGreaterThan(pet.y)
    const w = run(createFx(), 2, { rate: 120 })
    // 朝左打，所以枪口在手的左边
    expect(muzzleOf(w.gun).x).toBeLessThan(w.gun.x)
  })

  it("纸带在手的左边，左边界更靠左", () => {
    const t = tapeAt(handOf(pet, "slime"))
    expect(t.x).toBeLessThan(pet.x)
    expect(t.left).toBeLessThan(t.x)
  })

  it("螃蟹把枪接在横臂，不沿用会落到腿上的史莱姆挂点", () => {
    const slime = handOf(pet, "slime")
    const crab = handOf(pet, "crab")
    expect(crab.y).toBeLessThan(slime.y - 4)
    expect(crab.y).toBeGreaterThan(pet.y + 12)
    expect(crab.y).toBeLessThan(pet.y + 18)
    expect(crab.x).toBeGreaterThan(pet.x)
  })
})

describe("刷怪", () => {
  it("引擎顺的时候一只都不来", () => {
    const w = run(createFx(), 20, { rate: 180, running: true })
    expect(w.foes).toHaveLength(0)
  })

  it("静默久了会有东西爬过来", () => {
    const w = run(createFx(), 20, { rate: 0, running: true })
    expect(w.foes.length).toBeGreaterThan(0)
    expect(w.foes[0]?.kind).toBe("slime")
  })

  it("上下文快满时来的是胖子，哪怕这一轮没在跑", () => {
    const w = run(createFx(), 20, { rate: 0, running: false, ratio: 0.95 })
    expect(w.foes[0]?.kind).toBe("glut")
  })

  it("有东西过来就瞄它，不再对着纸带打", () => {
    const w = run(createFx(), 20, { rate: 0, running: true })
    expect(w.foes.length).toBeGreaterThan(0)
    const before = w.tape.length
    // 只跑一小段：**怪还活着的这段时间里**子弹全打在它身上，纸带不该变长
    run(w, 0.3, { rate: 180, running: true })
    expect(w.tape.length).toBeLessThanOrEqual(before)
  })

  it("火力够就清得掉，火力不够就被摸到脸上——这不是平衡，是事实", () => {
    // **两条支线各起一个世界**：stepFx 是原地改的，从同一个分叉会互相改对方的数组
    const fast = run(createFx(), 20, { rate: 0, running: true })
    const slow = run(createFx(), 20, { rate: 0, running: true })
    run(fast, 8, { rate: 400, running: true })
    run(slow, 8, { rate: 0, running: true })
    expect(fast.bites).toBeLessThan(slow.bites)
  })

  it("压力消失又出现时不会当场蹦一只——那一刻才刚开始不顺", () => {
    const w = run(createFx(), 40, { rate: 200, running: true })
    run(w, 1.5, { rate: 0, running: true })
    expect(w.foes).toHaveLength(0)
  })
})

describe("压力显形的开关", () => {
  it("关掉之后一只都不刷，但打纸带那一层照常", () => {
    const w = run(createFx(), 20, { rate: 0, running: true, foes: false })
    expect(w.foes).toHaveLength(0)
    run(w, 2, { rate: 180, running: true, foes: false })
    expect(w.tape.length).toBeGreaterThan(0)
  })
})

describe("弹壳", () => {
  it("三档各去各的地方，**不抛那一档一枚都不出**", () => {
    const off = run(createFx(), 2, { rate: 180, brass: "off" })
    const fly = run(createFx(), 2, { rate: 180, brass: "eject" })
    const pile = run(createFx(), 2, { rate: 180, brass: "pile" })
    expect(off.brass.flying.length + off.brass.pile.length).toBe(0)
    expect(fly.brass.flying.length).toBeGreaterThan(0)
    expect(pile.brass.pile.length).toBeGreaterThan(0)
  })

  it("**没输出就没有壳**——壳是开了一发的证据，不是装饰", () => {
    const w = run(createFx(), 4, { rate: 0, brass: "eject" })
    expect(w.brass.flying).toHaveLength(0)
  })

  it("堆着那一档在结账那一下被扫平：堆多高说的是这一轮，不是这一天", () => {
    const w = run(createFx(), 3, { rate: 180, running: true, brass: "pile" })
    expect(w.brass.pile.length).toBeGreaterThan(0)
    // 这一轮跑完 → 扫；扫走那一段飞完就空了
    run(w, 1.5, { rate: 0, running: false, brass: "pile" })
    expect(w.brass.pile).toHaveLength(0)
  })
})

describe("打靶", () => {
  it("弹着记在靶上，而纸带一个字都不落——同一把枪不能同时打两个地方", () => {
    const w = run(createFx(), 3, { rate: 180, range: true })
    expect(w.target.shots).toBeGreaterThan(0)
    expect(w.tape).toHaveLength(0)
  })

  it("**上下文越满命中率越低**，而那是唯一有资格影响它的东西", () => {
    const clear = run(createFx(), 6, { rate: 180, range: true, ratio: 0 })
    const full = run(createFx(), 6, { rate: 180, range: true, ratio: 0.95 })
    expect(rateOfHits(full)).toBeLessThan(rateOfHits(clear))
  })

  it("打靶开着时不刷怪：那张靶要的是干净的弹着", () => {
    const w = run(createFx(), 20, { rate: 0, running: true, range: true, foes: true })
    expect(w.foes).toHaveLength(0)
  })
})

function rateOfHits(w: FxWorld): number {
  return w.target.shots === 0 ? 0 : w.target.hits / w.target.shots
}

describe("胖子吃字", () => {
  /**
   * **不能靠「跑一会儿看纸带短没短」来判**：纸带本来就会自己往左漂走、到头就没，
   * 于是那个断言在胖子根本没接上线的时候也照样成立——第一版就是这么写的，
   * 扰动（把吃字那一句删掉）一条都没红。
   *
   * 所以这里手工把一只胖子摆在某个字上，只推一帧：**那个字必须当场消失**，
   * 而漂移在一帧里只走不到两个像素。
   */
  it("它嘴底下那个字当场没了——上下文满了，前面产出的东西真的会被压缩掉", () => {
    const w = run(createFx(), 2, { rate: 200, running: true, foes: false })
    const glyph = w.tape[Math.floor(w.tape.length / 2)]
    expect(glyph).toBeDefined()
    const spot = glyph?.x ?? 0
    spawnFoes(w.foes, "glut", { from: spot, ground: 150 }, () => 0)
    const before = w.tape.length
    run(w, 1 / 60, { rate: 200, running: true, ratio: 0.95 })
    expect(w.tape.length).toBeLessThan(before)
    expect(w.tape.some((g) => g === glyph)).toBe(false)
  })

  it("**只有胖子吃**：史莱姆从同一个字上走过去，字还在", () => {
    const w = run(createFx(), 2, { rate: 200, running: true, foes: false })
    const glyph = w.tape[Math.floor(w.tape.length / 2)]
    spawnFoes(w.foes, "slime", { from: glyph?.x ?? 0, ground: 150 }, () => 0)
    run(w, 1 / 60, { rate: 200, running: true })
    expect(w.tape.some((g) => g === glyph)).toBe(true)
  })
})

describe("换会话", () => {
  it("**上一条的怪、纸带、弹壳、靶一样都不许留下来**——它们说的是没在这条会话里发生的事", () => {
    // 四样都得先真的攒出来，否则「清干净了」这句断言是空的（第一版就是这样，
    // 把清靶那一行删掉照样绿——靶根本没被填过）
    const w = run(createFx(), 3, { rate: 200, running: true, brass: "pile", range: true })
    expect(w.target.shots).toBeGreaterThan(0)
    expect(w.brass.pile.length).toBeGreaterThan(0)
    // 纸带得在没有怪的时候攒：**有怪在场时子弹优先打怪**，纸带上一个字都不落
    run(w, 2, { rate: 200, running: true, brass: "pile" })
    expect(w.tape.length).toBeGreaterThan(0)
    // 怪直接塞进去，不靠等：等的那几秒里纸带会飘走、弹壳会淡掉
    //（`PILE_LIFE`），四样根本凑不齐一屏
    spawnFoes(w.foes, "slime", { from: 0, ground: 150 }, () => 0)
    expect(w.foes.length).toBeGreaterThan(0)
    resetFx(w)
    expect(w.tape).toHaveLength(0)
    expect(w.foes).toHaveLength(0)
    expect(w.bullets).toHaveLength(0)
    expect(w.brass.pile).toHaveLength(0)
    expect(w.brass.flying).toHaveLength(0)
    expect(w.target).toEqual({ holes: [], hits: 0, shots: 0 })
    expect(w.bites).toBe(0)
    expect(w.quiet).toBe(0)
  })

  it("清完是**同一个对象**，不是换了一个新的——正在跑的那一帧还攥着旧引用", () => {
    const w = createFx()
    const tape = w.tape
    const foes = w.foes
    resetFx(w)
    expect(w.tape).toBe(tape)
    expect(w.foes).toBe(foes)
  })

  it("清完还能接着跑，而且靶上重新开始记账", () => {
    const w = run(createFx(), 3, { rate: 200, range: true })
    resetFx(w)
    run(w, 3, { rate: 200, range: true })
    expect(w.target.shots).toBeGreaterThan(0)
  })
})

describe("抛壳弹道", () => {
  it("**这一发就是那枚壳**：没有子弹、纸带一个字都不落，壳照样出来", () => {
    const w = run(createFx(), 3, { rate: 180, traj: "shell", brass: "eject" })
    expect(w.tape).toHaveLength(0)
    expect(w.brass.flying.length).toBeGreaterThan(0)
  })

  it("一发一枚，**不会一发两枚**——那样说不清哪个是「这一发」", () => {
    const tape = run(createFx(), 1.5, { rate: 60, traj: "tape", brass: "eject" })
    const shell = run(createFx(), 1.5, { rate: 60, traj: "shell", brass: "eject" })
    // 打字机那一档：一发一颗子弹 + 侧面一枚壳；抛壳那一档：一发就一枚壳
    expect(shell.brass.flying.length).toBe(tape.brass.flying.length)
    expect(shell.bullets).toHaveLength(0)
  })

  it("「堆着」在这一档下照样堆，结账照样扫平", () => {
    const w = run(createFx(), 3, { rate: 180, running: true, traj: "shell", brass: "pile" })
    expect(w.brass.pile.length).toBeGreaterThan(0)
    run(w, 1.5, { rate: 0, running: false, traj: "shell", brass: "pile" })
    expect(w.brass.pile).toHaveLength(0)
  })

  it("**「不抛」吞不掉它**：这一档下那一发确实发生了，界面上那一格因此变灰", () => {
    const w = run(createFx(), 2, { rate: 180, traj: "shell", brass: "off" })
    expect(w.brass.flying.length).toBeGreaterThan(0)
  })

  it("**有东西爬过来时照旧直射**——不然选了抛壳就永远清不掉，胜负说的就成了你的设置", () => {
    const w = run(createFx(), 20, { rate: 0, running: true, traj: "shell" })
    expect(w.foes.length).toBeGreaterThan(0)
    const hp = w.foes[0]?.hp ?? 0
    run(w, 1.5, { rate: 400, running: true, traj: "shell" })
    expect(w.bullets.length + (hp - (w.foes[0]?.hp ?? 0))).toBeGreaterThan(0)
  })

  it("打靶开着时也照旧直射，不改成抛壳", () => {
    const w = run(createFx(), 3, { rate: 180, traj: "shell", range: true })
    expect(w.target.shots).toBeGreaterThan(0)
  })
})

describe("切走很久再回来", () => {
  it("**回来那一刻不该已经被围了**：一帧几百秒的 dt 不能一次性灌进钟里", () => {
    const w = createFx()
    // 切到别的应用待五分钟，回来时浏览器补一帧巨大的 dt
    stepFx(w, 300, input({ rate: 0, running: true }))
    expect(w.quiet).toBeLessThanOrEqual(1)
    expect(w.foes).toHaveLength(0)
  })

  it("慢拍那一档照常走：120ms 一拍时静默计时不被夹住", () => {
    const w = createFx()
    for (let t = 0; t < 4; t += 0.12) stepFx(w, 0.12, input({ rate: 0, running: true }))
    expect(w.quiet).toBeGreaterThan(3)
  })
})

describe("打靶：靶是钉死的", () => {
  const field = { homeX: 400, ground: 150 }
  const at = (x: number, y: number): Pet => ({ x, y, vx: 0, vy: 0, spin: 0, mode: "held" })

  it("**桌宠动，靶不动**——这是它能当台子用的全部前提", () => {
    const home = run(createFx(), 1, { range: true, rate: 90, field })
    const away = run(createFx(), 1, { range: true, rate: 90, field, pet: at(900, 20) })
    expect(away.view.stand).toEqual(home.view.stand)
    // 靶场留在右侧宠物带，不再跨 200px 压到正文操作区。
    expect(field.homeX - home.view.stand.x).toBeGreaterThan(130)
    expect(field.homeX - home.view.stand.x).toBeLessThan(160)
  })

  it("把它拖到半空，靶杆照旧立在地面线上；弹壳还是落在它自己脚下", () => {
    const w = run(createFx(), 1, { range: true, rate: 90, field, pet: at(400, 10) })
    expect(w.view.stand.ground).toBe(field.ground)
    // 两条线不能合：上一版只有一条，于是把它拖到半空时靶也跟着悬空
    expect(w.view.ground).not.toBe(field.ground)
  })

  it("拖远了打得散：同样的火力，站在窝里那一组更紧", () => {
    // 流速取中档：太高时后坐一路顶到靶纸边缘，两组都被夹在同一圈上，
    // 量出来的就成了夹钳而不是散布
    const shots = { range: true, rate: 60, field }
    // **别拉太远**：弹着夹在靶纸内（`punch` 的 clamp），拉到几百像素之外时
    // 每一发都顶在边上，散布反而塌成一圈——那时量的是夹钳不是物理
    const home = run(createFx(), 4, { ...shots, pet: at(400, 120) })
    const away = run(createFx(), 4, { ...shots, pet: at(560, 120) })
    expect(home.target.shots).toBeGreaterThan(3)
    expect(spreadOf(away.target) ?? 0).toBeGreaterThan(spreadOf(home.target) ?? 9)
  })

  it("窄窗口下窝很靠左，靶也不会被推到画布外面去", () => {
    const w = run(createFx(), 1, { range: true, rate: 90, field: { homeX: 60, ground: 150 } })
    expect(w.view.stand.x).toBeGreaterThan(0)
  })
})

describe("换弹", () => {
  it("打满一匣就停一下：那一串弹着断成一簇一簇，不是一条连续的线", () => {
    const w = run(createFx(), 6, { rate: 160, running: true })
    // 停火那一段里枪口是垂着的；六秒里必然经历过好几次
    expect(w.gun.mag).toBeGreaterThan(0)
    expect(w.gun.mag).toBeLessThanOrEqual(14)
  })

  it("**换弹不改「火力恒等于流速」**：停的是几发的工夫，不是几秒", () => {
    // 固定秒数的换弹会按流速高低吃掉不同比例的发数，比值当场就不是 2 了
    const slow = shotsAt(50, 5)
    const fast = shotsAt(100, 5)
    const ratio = fast / Math.max(1, slow)
    expect(ratio).toBeGreaterThan(1.7)
    expect(ratio).toBeLessThan(2.3)
  })

  it("高流速下也不会卡死在换弹里——占空比和流速无关", () => {
    // 真卡死的话一发都出不来
    expect(shotsAt(240, 5)).toBeGreaterThan(50)
  })

  it("收枪之后弹匣是满的：下次抽出来不该接着上次那半匣", () => {
    const w = run(createFx(), 4, { rate: 200 })
    expect(w.gun.mag).toBeLessThanOrEqual(14)
    run(w, 6, { rate: 0 })
    expect(w.gun.arm).toBe(0)
    expect(w.gun.mag).toBe(14)
    expect(w.gun.reload).toBe(0)
  })
})

describe("拎着它一边拖一边打", () => {
  it("壳落到台面，不落到那只此刻的脚下——不然整屏悬着壳", () => {
    // 把它拎到半空：脚线（pet.y + 30）比台面高出一大截
    const air: Pet = { ...pet, y: 40, mode: "held" }
    const table = 400
    const w = createFx()
    run(w, 1.2, { pet: air, rate: 120, running: true, brass: "pile", field: { homeX: air.x, ground: table } })
    const shells = [...w.brass.pile, ...w.brass.flying]
    expect(shells.length).toBeGreaterThan(0)
    // 每一枚的落点都在台面上，而不是在半空那条脚线上
    for (const shell of shells) {
      expect(shell.gy).toBeGreaterThan(table - 6)
      expect(shell.gy).toBeLessThanOrEqual(table)
    }
  })
})
