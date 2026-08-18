import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * 模型产出的 Markdown。
 *
 * **和桌面端用同一套解析器**（`react-markdown` + `remark-gfm`）。手搓一个轻量
 * 渲染器省下来的那点体积，换来的是「同一段回答在两端长得不一样」——
 * 表格塌了、嵌套列表串行、代码块里的反引号漏出来。那些不是小毛病，
 * 是让人读错内容的毛病。
 *
 * **安全前提和桌面端同一条**：模型输出是不可信内容，而 `react-markdown`
 * 渲染成 React 元素而不是 HTML 字符串——结构上不存在注入面。
 * ⚠️ 永远不要加 `rehype-raw`，那个插件的作用正是把原始 HTML 放回来。
 *
 * 不跑语法高亮（桌面端有）：那要再拖一个几十 KB 的包进首屏，
 * 而这一端的用途是「在外面看一眼」，不是读代码。
 *
 * 它进了单独的 vendor 块（见 `vite.config.ts`），改界面代码不会让它重下。
 */

/** 链接强制新开窗口并断掉 opener：正文是模型产出的，里面的链接不受我们控制。 */
function Anchor({ href, children }: { href?: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}

/** 宽表格由外层容器滚动——给 table 自己加 overflow 会拆散 thead/tbody。 */
function Table({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="md__scroll">
      <table>{children}</table>
    </div>
  )
}

/** 代码块同理：窄屏上一行长命令会把整个布局撑破。 */
function Pre({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="md__scroll">
      <pre>{children}</pre>
    </div>
  )
}

/*
 * 插件数组与组件表**必须提到模块作用域**。
 *
 * 写成行内字面量的话，每次 render 都是新数组、新对象，`ReactMarkdown` 内部
 * 一律当成「配置变了」重建整条 unified 管线——于是下面那个 `memo` 白包。
 * 这类失效是静默的：功能全对，只是每帧多花一毫秒，测不出来也看不出来。
 *
 * 这一段是照抄桌面端的（`renderer/components/Markdown.tsx`）——**上一版这一条
 * 一个字都没抄**，两个字面量都写在行内，于是这一端从来没有过 memo 的收益。
 */
const REMARK = [remarkGfm]
const COMPONENTS = { a: Anchor, table: Table, pre: Pre }

export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
