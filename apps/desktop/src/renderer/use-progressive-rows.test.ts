import { describe, expect, it } from "vitest"
import { FIRST, STEP, firstFloor, mountedRows, nextFloor } from "./use-progressive-rows.js"

const rows = (n: number): readonly number[] => Array.from({ length: n }, (_, i) => i)

describe("长会话分片挂载", () => {
  const cases = [
    ["短会话一次挂满", 12, firstFloor(12), false, 0, 12],
    ["长会话先挂末尾", 500, firstFloor(500), false, 500 - FIRST, FIRST],
    ["补一片后下限上移", 500, nextFloor(firstFloor(500)), false, 500 - FIRST - STEP, FIRST + STEP],
    ["补到顶为止", 500, nextFloor(30), false, 0, 500],
    ["查找时全量", 500, firstFloor(500), true, 0, 500],
    ["流式追加不挤掉已挂的行", 505, firstFloor(500), false, 500 - FIRST, FIRST + 5],
    ["折起几轮后仍只挂末尾", 20, 460, false, 0, 20],
    ["行数跌破下限时退回末尾", 300, 460, false, 300 - FIRST, FIRST],
  ] as const
  for (const [name, total, floor, full, first, count] of cases) {
    it(name, () => {
      const shown = mountedRows(rows(total), floor, full)
      expect(shown[0]).toBe(first)
      expect(shown.length).toBe(count)
    })
  }
})
