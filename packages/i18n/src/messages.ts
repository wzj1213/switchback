/**
 * 一条文案：要么是一句话，要么是拿参数拼一句话的函数。
 *
 * 数字、名字、单复数都放进函数里拼，不发明一套占位符语法：英文的复数、
 * 中文的量词、两种语言里参数的先后，函数里一眼就看得清，类型也查得到。
 */
export type Message = string | ((...args: never[]) => string)

export type Messages = Readonly<Record<string, Message>>

/** 另一种语言的那一版：键一个不能少，带参数的文案参数也得对得上。 */
export type Translation<M extends Messages> = {
  readonly [K in keyof M]: M[K] extends string ? string : M[K]
}

export type Catalog<M extends Messages> = Readonly<Record<"zh-CN" | "en", Translation<M>>>

/**
 * 一份文案的中英两版。中文写在前面，它是默认，也是这份文案的「原文」。
 *
 * ```ts
 * const MESSAGES = defineMessages(
 *   { title: "设置", files: (n: number) => `改了 ${n} 个文件` },
 *   { title: "Settings", files: (n) => `${count(n, "file")} changed` },
 * )
 * MESSAGES[locale].files(3)
 * ```
 */
export function defineMessages<M extends Messages>(zh: M, en: Translation<M>): Catalog<M> {
  // M 和 Translation<M> 只差在字面量收窄成 string，泛型里 TS 证不出来；这一步断言是安全的
  return { "zh-CN": zh as Translation<M>, en }
}
