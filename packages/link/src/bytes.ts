import type { WireBytes } from "@switchback/wire"

/**
 * 调用参数里的字节怎么上线（`@switchback/wire` 的 `WireBytes`）。
 *
 * `ArrayBuffer` 过不了 JSON：`JSON.stringify` 把它写成 `{}`，宿主收到一个空对象，
 * 贴图那条路就安静地变成「什么都没存」。所以第一层里的字节编成 `{ $bytes: <base64> }`，
 * 宿主还原成 `Buffer`。**只看第一层**——通道参数本来就是扁平的一层对象。
 */

/** 一口气喂给 `String.fromCharCode` 的上限。展开成参数，太长会撑爆调用栈。 */
const SLICE = 0x8000

function base64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let at = 0; at < bytes.length; at += SLICE) {
    parts.push(String.fromCharCode(...bytes.subarray(at, at + SLICE)))
  }
  return btoa(parts.join(""))
}

function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}

export function packBytes(arg: unknown): unknown {
  if (typeof arg !== "object" || arg === null || Array.isArray(arg)) return arg
  return Object.fromEntries(
    Object.entries(arg).map(([key, value]) => {
      const bytes = bytesOf(value)
      return [key, bytes === undefined ? value : ({ $bytes: base64(bytes) } satisfies WireBytes)]
    }),
  )
}
