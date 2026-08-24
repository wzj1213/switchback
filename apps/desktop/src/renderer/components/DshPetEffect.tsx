import { useEffect, useRef, useState } from "react"

export type DshPetPhase = "idle" | "running" | "success" | "failure"

/** 只在真实 DSH 活动结束时闪一次结果；初次挂载在 idle 不冒充一次成功。 */
export function useDshPetPhase(active: boolean, failed: boolean): DshPetPhase {
  const before = useRef(active)
  const [phase, setPhase] = useState<DshPetPhase>(active ? "running" : "idle")
  useEffect(() => {
    const wasActive = before.current
    before.current = active
    if (active) {
      setPhase("running")
      return undefined
    }
    if (!wasActive) return undefined
    setPhase(failed ? "failure" : "success")
    const timer = setTimeout(() => setPhase("idle"), 1100)
    return () => clearTimeout(timer)
  }, [active, failed])
  return phase
}

/** 插件节点只表达“可插拔组装”这一机制，不把固定四点冒充 profile 的真实插件数。 */
export function DshPetEffect({ phase }: { phase: DshPetPhase }): React.JSX.Element {
  return (
    <span className={`dsh-fx dsh-fx--${phase}`}>
      <span className="dsh-fx__ring dsh-fx__ring--one" />
      <span className="dsh-fx__ring dsh-fx__ring--two" />
      <span className="dsh-fx__orbit">
        <i className="dsh-fx__plugin dsh-fx__plugin--one" />
        <i className="dsh-fx__plugin dsh-fx__plugin--two" />
        <i className="dsh-fx__plugin dsh-fx__plugin--three" />
        <i className="dsh-fx__plugin dsh-fx__plugin--four" />
      </span>
      <span className="dsh-fx__bubble dsh-fx__bubble--one" />
      <span className="dsh-fx__bubble dsh-fx__bubble--two" />
    </span>
  )
}
