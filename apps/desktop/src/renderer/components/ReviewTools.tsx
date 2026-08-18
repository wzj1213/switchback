/**
 * 审核面板头上那排开关：未跟踪、并排/单栏、上下文行数、刷新。
 *
 * 从 `Review` 拆出来是行数闸门逼的，但这一刀顺：那边管「哪个文件、哪份补丁」，
 * 这里只管「这一屏怎么看」。
 */

/** 上下文行数三档。**「整个文件」不是无限**，是一个大到没人会翻完的数。 */
const CONTEXT = [
  { n: 3, label: "3 行" },
  { n: 12, label: "12 行" },
  { n: 9999, label: "整个文件" },
] as const

export function Tools({ split, onSplit, context, onContext, onReload, untracked }: {
  split: boolean
  onSplit: (on: boolean) => void
  context: number
  onContext: (n: number) => void
  onReload: () => void
  /** 未跟踪那一档的开关。一个都没有时不给——不存在的东西不该有开关。 */
  untracked?: { on: boolean; count: number; onToggle: (on: boolean) => void }
}): React.JSX.Element {
  return (
    <div className="rv__tools">
      {/* 生成出来的图、导出的产物、还没进 .gitignore 的中间文件——它们确实变了，
          但和「这次要不要提交」基本无关，一多就把真正要看的改动埋了。
          **不默认藏**：agent 新建的源文件也是未跟踪的，那正是最该看的 */}
      {untracked === undefined ? null : (
        <button
          type="button"
          className={`rv__seg${untracked.on ? " rv__seg--on" : ""}`}
          title={untracked.on ? `列表里含 ${String(untracked.count)} 个未跟踪的文件，点一下收起` : `${String(untracked.count)} 个未跟踪的文件被收起了`}
          onClick={() => {
            untracked.onToggle(!untracked.on)
          }}
        >
          未跟踪 {untracked.count}
        </button>
      )}
      <span className="rv__gap" />
      {([true, false] as const).map((on) => (
        <button
          key={String(on)}
          type="button"
          className={`rv__seg${split === on ? " rv__seg--on" : ""}`}
          onClick={() => {
            onSplit(on)
          }}
        >
          {on ? "并排" : "单栏"}
        </button>
      ))}
      <span className="rv__gap" />
      {CONTEXT.map((c) => (
        <button
          key={c.n}
          type="button"
          className={`rv__seg${context === c.n ? " rv__seg--on" : ""}`}
          title="上下文行数"
          onClick={() => {
            onContext(c.n)
          }}
        >
          {c.label}
        </button>
      ))}
      <button type="button" className="rv__seg" onClick={onReload} title="重新问一遍 git">
        刷新
      </button>
    </div>
  )
}
