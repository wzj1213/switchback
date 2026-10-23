import { Component, type ErrorInfo, type ReactNode } from "react"
import { documentLocale } from "../i18n.js"
import { BOUNDARY } from "./Boundary.messages.js"

interface Props {
  children: ReactNode
}

interface State {
  message: string | undefined
  stack: string | undefined
}

/**
 * 渲染层的最后一道兜底。
 *
 * React 的默认行为是：任何一个组件抛异常，**整棵树被卸载**，屏幕一片空白。
 * 对用户来说这和「应用死了」没有区别，而且不留任何线索——
 * 正在跑的引擎其实还活着，日志也还在，但他什么都看不到、什么都做不了。
 *
 * 这里接住它，把错误摆出来，并给一条**能自己走出去的路**（重载窗口）。
 * 一个白屏加一句「请重启」不是生产级；一个说得出哪里炸了、点一下能回去的界面才是。
 *
 * 用 class 组件是因为**错误边界只有类组件能做**——React 至今没有 hook 版本。
 */
export class Boundary extends Component<Props, State> {
  override state: State = { message: undefined, stack: undefined }

  static getDerivedStateFromError(error: unknown): State {
    return {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 主进程日志是排查时唯一还看得到的东西，组件栈必须留在那里。
    // 该用 console 的地方只有两处，判据都是「没有别的出口」：这里是界面已经没了，
    // 另一处是 `use-shift-watch.ts`（诊断要进用户拿得到的那份日志，而渲染层
    // 只有 `warn` / `error` 会被主进程转发过去）。
    // eslint-disable-next-line no-console
    console.error("渲染层崩溃：", error, info.componentStack) // i18n-ok：开发日志，不上界面
  }

  override render(): ReactNode {
    const { message, stack } = this.state
    if (message === undefined) return this.props.children
    // 这一层包在语言上下文外面（`main.tsx`），语言从 `<html lang>` 读回来
    const m = BOUNDARY[documentLocale()]
    return (
      <div className="crash">
        <div className="crash__box">
          <div className="crash__title">{m.title}</div>
          <div className="crash__msg">{message}</div>
          <p className="crash__hint">{m.hint}</p>
          <div className="crash__actions">
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => {
                window.location.reload()
              }}
            >
              {m.reload}
            </button>
          </div>
          {stack === undefined ? null : <pre className="crash__stack">{stack}</pre>}
        </div>
      </div>
    )
  }
}
