import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * 渲染模型产出的 Markdown。
 *
 * **安全前提：模型输出是不可信内容。** 选 `react-markdown` 而不是
 * `marked`/`markdown-it` + `dangerouslySetInnerHTML`，是因为它渲染成 React 元素而不是
 * HTML 字符串——**结构上不存在注入面**，不依赖任何消毒环节做对。
 *
 * ⚠️ 永远不要加 `rehype-raw`。那个插件的作用正是把原始 HTML 放回来，
 * 加上它这道结构性保证就没了。
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

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: Anchor, table: Table }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
