import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { rehypeHighlight } from "../highlight.js"

/**
 * 渲染模型产出的 Markdown。
 *
 * **安全前提：模型输出是不可信内容。** 选 `react-markdown` 而不是
 * `marked`/`markdown-it` + `dangerouslySetInnerHTML`，是因为它渲染成 React 元素而不是
 * HTML 字符串——**结构上不存在注入面**，不依赖任何消毒环节做对。
 *
 * ⚠️ 永远不要加 `rehype-raw`。那个插件的作用正是把原始 HTML 放回来，
 * 加上它这道结构性保证就没了。
 *
 * 语法高亮同理：用 `rehype-highlight`（产出 hast 元素树）而不是
 * `highlight.js` 直接生成 HTML 字符串再 `dangerouslySetInnerHTML`。
 * hljs 自己会转义，那条路"实际上"也安全——但它把安全性重新变成
 * 「某个环节做对了」，而不是「结构上不可能」。
 */

/** 链接必须走外部浏览器：留在渲染层里点一下就把整个应用导航走了。 */
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

/*
 * 插件数组与组件表**必须提到模块作用域**。
 *
 * 写成行内字面量的话，每次 render 都是新数组、新对象，`ReactMarkdown` 内部
 * 一律当成「配置变了」重建整条 unified 管线——于是下面那个 `memo` 白包。
 * 这类失效是静默的：功能全对，只是每帧多花一毫秒，测不出来也看不出来。
 */
const REMARK = [remarkGfm]
// 高亮插件产出的是 **hast 元素树**，不是 HTML 字符串——
// 所以加它不违反上面那条红线：结构上仍然不存在注入面。见 `highlight.ts`。
const REHYPE = [rehypeHighlight]
const REHYPE_NONE: [] = []
const COMPONENTS = { a: Anchor, table: Table }

/**
 * @param streaming 这段文字还在流。**流式期间不跑语法高亮**，两个原因：
 *
 * 1. 实测同一条消息，只解析 0.53ms，加上高亮 1.49ms——**高亮比解析还贵**，
 *    占掉三分之二，而它每 16ms 要重来一次。
 * 2. 没闭合的 ``` 围栏会先按半截内容着一次色，定稿时颜色整块跳变。
 *    dsh 在流式那支干脆不装会出错的渲染器，同一个道理。
 *
 * 定稿之后一次性着色，颜色只出现一次、不再变。
 */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string
  streaming?: boolean
}): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={streaming ? REHYPE_NONE : REHYPE}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
