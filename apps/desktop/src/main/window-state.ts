import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { app, screen, type BrowserWindow } from "electron"

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT: Bounds = { x: 0, y: 0, width: 1180, height: 780 }
const MIN_VISIBLE = 80

const file = (): string => join(app.getPath("userData"), "window.json")

function isBounds(value: unknown): value is Bounds {
  if (typeof value !== "object" || value === null) return false
  const b = value as Partial<Bounds>
  return ["x", "y", "width", "height"].every((k) => typeof b[k as keyof Bounds] === "number")
}

/**
 * 这块区域还在某个屏幕上吗。
 *
 * **必须查。** 在外接显示器上关掉、拔掉线再开，存下来的坐标会落在一块
 * 已经不存在的屏幕上——窗口就"打开"在看不见的地方，用户以为应用没启动。
 * 只要有一小块（80px）落在任一屏幕的工作区里就算可见。
 */
export function visibleOn(bounds: Bounds, areas: readonly Bounds[]): boolean {
  return areas.some((area) => {
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapX >= MIN_VISIBLE && overlapY >= MIN_VISIBLE
  })
}

export async function loadBounds(): Promise<Bounds> {
  const text = await readFile(file(), "utf8").catch(() => "")
  if (text === "") return DEFAULT
  try {
    const value: unknown = JSON.parse(text)
    if (!isBounds(value)) return DEFAULT
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    return visibleOn(value, areas) ? value : DEFAULT
  } catch {
    return DEFAULT
  }
}

/**
 * 记住窗口位置。**最大化/全屏时不记**——记下来的话下次会以一个
 * 铺满屏幕但没有最大化的普通窗口打开，看着像坏了。
 */
export function trackBounds(win: BrowserWindow): void {
  const save = (): void => {
    if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return
    const bounds = win.getBounds()
    void mkdir(dirname(file()), { recursive: true })
      .then(() => writeFile(file(), JSON.stringify(bounds), "utf8"))
      .catch(() => undefined)
  }
  // 拖动/缩放期间会触发很多次；关窗时那一次才是最终值，其余是尽力而为
  win.on("resized", save)
  win.on("moved", save)
  win.on("close", save)
}
