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
 * 它进了单独的 vendor 块（见 `vite.config.ts`），改界面代码不会让它重下。
 *
 * `a` 强制新开窗口并断掉 opener：正文是模型产出的，里面的链接不受我们控制。
 */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          // 表格和代码块在窄屏上会撑破布局，各自裹一层可横滚的容器
          table: ({ children }) => (
            <div className="md__scroll">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => (
            <div className="md__scroll">
              <pre>{children}</pre>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
