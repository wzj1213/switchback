import { useEffect, useRef, useState } from "react"
import type { FilePreview } from "../../shared/file-preview.js"
import type { PreviewTarget } from "../workbench.js"
import { headingSlug } from "../message-links.js"
import { Markdown } from "./Markdown.js"
import { Source } from "./file-source.js"

export function TextPreview({ file, target, onCopy }: {
  file: Extract<FilePreview, { kind: "text" }>
  target?: PreviewTarget | undefined
  onCopy: (text: string) => unknown
}): React.JSX.Element {
  const [source, setSource] = useState(target?.line !== undefined)
  const box = useRef<HTMLDivElement>(null)
  const markdown = file.language === "markdown" && !file.truncated && file.text.length < 200_000
  useEffect(() => { setSource(target?.line !== undefined) }, [target?.line, target?.at])
  useEffect(() => {
    if (source || target?.fragment === undefined) return
    const heading = [...(box.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? [])]
      .find((node) => headingSlug(node.textContent) === target.fragment)
    heading?.scrollIntoView({ block: "start", behavior: "instant" })
  }, [source, target?.fragment, target?.at, file.text])
  if (!markdown) return <Source file={file} target={target} onCopy={onCopy} />
  return (
    <div className="text-preview">
      <div className="html-preview__switch" aria-label="Markdown 查看方式">
        <button type="button" aria-pressed={!source} onClick={() => { setSource(false) }}>预览</button>
        <button type="button" aria-pressed={source} onClick={() => { setSource(true) }}>源码</button>
      </div>
      {source ? <Source file={file} target={target} onCopy={onCopy} /> : (
        <div className="text-preview__document" ref={box} tabIndex={0} aria-label="Markdown 文档预览">
          <Markdown text={file.text} />
        </div>
      )}
    </div>
  )
}
