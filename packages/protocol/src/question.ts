import type { QuestionId } from "./ids.js"

/** 一道结构化问题里的一个原生选项。id 由引擎给，omni 不改写。 */
export interface QuestionOption {
  id: string
  label: string
  description?: string
  /** 引擎给出的聚焦预览；可放代码、方案片段或文本 mockup。 */
  preview?: string
}

/**
 * 引擎明确交给人选择的一道题。
 *
 * 文本与选项都来自引擎；两端只呈现，不补推荐、不替用户挑。
 */
export interface QuestionPrompt {
  id: string
  question: string
  header?: string
  body?: string
  options: readonly QuestionOption[]
  multiSelect?: boolean
  allowOther?: boolean
  otherLabel?: string
  otherDescription?: string
  /** 有选项时，选择后是否可附备注；无选项时就是自由回答。 */
  allowNote?: boolean
  noteLabel?: string
  noteDescription?: string
  /** 自由回答要用密码框遮住；选项本身仍照常展示。 */
  secret?: boolean
  /** 空白可以明确回成 skipped，不挡住同组其他题。 */
  optional?: boolean
  /**
   * 引擎明确要求用户核对并打开的外部地址。只用于原生交互卡，不从普通文本自动 linkify。
   * URL 已由驱动限制为 HTTP(S)；两端仍在各自的特权边界再次校验。
   */
  external?: { url: string; warning?: string }
}

/** 人对一道题的原始选择。选项 id 保持原样回给提出问题的引擎。 */
export type QuestionAnswer =
  | { kind: "single"; optionId: string; note?: string }
  | { kind: "multi"; optionIds: readonly string[]; note?: string }
  | { kind: "note"; text: string }
  | { kind: "other"; text: string }
  | { kind: "multi_with_other"; optionIds: readonly string[]; otherText: string }
  | { kind: "skipped" }

/** 跳过整组和逐题回答必须分开；空 answers 不冒充用户选择了什么。 */
export type QuestionResponse =
  | { answers: Readonly<Record<string, QuestionAnswer>> }
  | { dismissed: true }

/** 当前挂在一条会话上、等待用户处理的一组问题。id 由宿主铸造。 */
export interface PendingQuestion {
  id: QuestionId
  questions: readonly QuestionPrompt[]
  /** 宿主会在这个 Unix 毫秒时间点把未回答的非阻塞问题跳过。 */
  expiresAt?: number
}
