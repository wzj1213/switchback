import type { ChunkFrame, ServerFrame, WireFrame } from "./types.js"

/**
 * 大帧的切分与重组。
 *
 * ## 为什么非切不可
 *
 * 一次全量重建可以是几 MB。中间隔着反向代理（nginx 默认就有帧上限）、
 * 隔着移动网络的中间设备，而**在最后一跳才失败的传输比不传输糟**——
 * 那时你已经付完了流量和等待。
 *
 * ## 为什么按码元切而不是按字节
 *
 * 按字节切要先编码再切再解码，中间还要处理跨片的多字节序列；base64 又白涨三分之一。
 * 按 UTF-16 码元切，拼回来是**同一个字符串**（逐码元拼接不会变形），
 * 唯一要小心的是**别把代理对切开**——半个代理对不是合法 UTF-8，
 * WebSocket 的文本帧发不出去。下面那个 `cut` 就是干这个的。
 *
 * 代价：一片的字节数最坏是码元数的三倍（中文）到四倍（emoji）。
 * 所以码元上限取得保守，宁可多切几片。
 */

/** 一片最多多少个 UTF-16 码元。最坏情况（全 emoji）下约 64 KB。 */
const MAX_CHUNK_CHARS = 16_384

/** 最多切多少片。超过说明这条帧根本不该走这条路。 */
const MAX_CHUNKS = 1024

/** 重组出来的字符串上限。防的是「一个恶意的对端报 1024 片、每片撑满」。 */
const MAX_ASSEMBLED_CHARS = MAX_CHUNK_CHARS * MAX_CHUNKS

/**
 * 找一个不会把代理对切开的切点。
 *
 * 判据用**低位代理**：`text[at]` 是低位代理，就说明 `text[at - 1]` 是高位代理，
 * 这一刀正落在一对中间——往后挪一格，把整对留在前一片里。
 */
function cut(text: string, at: number): number {
  if (at >= text.length) return text.length
  const code = text.charCodeAt(at)
  return code >= 0xdc00 && code <= 0xdfff ? at + 1 : at
}

/**
 * 把一条帧编成线上要发的一条或多条字符串。
 *
 * 小帧原样发（不套壳，省掉一次解析）；大帧切片，每片自带 `id/index/count`。
 * @param id 这条逻辑帧的编号，由调用方递增。只有切片时才用得到。
 */
export function encodeFrame(frame: ServerFrame, id: number, maxChars = MAX_CHUNK_CHARS): readonly string[] {
  const text = JSON.stringify(frame)
  if (text.length <= maxChars) return [text]
  const parts: string[] = []
  let at = 0
  while (at < text.length) {
    const end = cut(text, Math.min(at + maxChars, text.length))
    parts.push(text.slice(at, end))
    at = end
  }
  return parts.map((body, index) =>
    JSON.stringify({ type: "chunk", id, index, count: parts.length, body } satisfies ChunkFrame),
  )
}

/** 一次观察的结果。**「还没凑齐」和「丢掉了」必须分得开**——后者要报出去。 */
export type Assembled =
  | { kind: "frame"; frame: ServerFrame }
  | { kind: "pending" }
  | { kind: "dropped"; reason: string }

export interface Reassembler {
  /** 喂一条线上收到的字符串。 */
  observe: (text: string) => Assembled
}

interface Assembly {
  id: number
  count: number
  next: number
  parts: string[]
  chars: number
}

/** 一片是不是自洽的（不看它和在装配的那条对不对得上）。 */
function malformed(chunk: ChunkFrame): string | undefined {
  if (!Number.isInteger(chunk.count) || chunk.count <= 0 || chunk.count > MAX_CHUNKS) return "片数不合法"
  if (!Number.isInteger(chunk.index) || chunk.index < 0 || chunk.index >= chunk.count) return "片号越界"
  if (typeof chunk.body !== "string") return "片体不是字符串"
  return undefined
}

export function createReassembler(maxAssembled = MAX_ASSEMBLED_CHARS): Reassembler {
  const state: { current: Assembly | undefined } = { current: undefined }

  const drop = (reason: string): Assembled => {
    state.current = undefined
    return { kind: "dropped", reason }
  }

  const take = (chunk: ChunkFrame): Assembled => {
    const bad = malformed(chunk)
    if (bad !== undefined) return drop(bad)
    // 换了一条逻辑帧：上一条没装完就作废。**不并行装配多条**——
    // 一条连接上的帧是有序的，同时装两条只可能是对端出了问题
    const current =
      state.current?.id === chunk.id
        ? state.current
        : { id: chunk.id, count: chunk.count, next: 0, parts: [], chars: 0 }
    state.current = current
    if (chunk.count !== current.count) return drop("同一条帧的片数前后不一致")
    // 严格按序：乱序意味着中间漏了片，而漏了片拼出来的是一段坏 JSON
    if (chunk.index !== current.next) return drop(`片号跳了：期待 ${String(current.next)}，来的是 ${String(chunk.index)}`)
    current.chars += chunk.body.length
    if (current.chars > maxAssembled) return drop("重组超过上限")
    current.parts.push(chunk.body)
    current.next += 1
    if (current.next < current.count) return { kind: "pending" }
    const text = current.parts.join("")
    state.current = undefined
    return parse(text)
  }

  const parse = (text: string): Assembled => {
    try {
      return { kind: "frame", frame: JSON.parse(text) as ServerFrame }
    } catch (error) {
      return { kind: "dropped", reason: `不是合法 JSON：${String(error)}` }
    }
  }

  return {
    observe: (text) => {
      let frame: WireFrame
      try {
        frame = JSON.parse(text) as WireFrame
      } catch (error) {
        return drop(`不是合法 JSON：${String(error)}`)
      }
      if (frame.type !== "chunk") {
        // 整帧到达时把在装配的那条作废：它已经不可能拼完了
        state.current = undefined
        return { kind: "frame", frame }
      }
      return take(frame)
    },
  }
}
