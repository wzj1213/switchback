import { createLowlight } from "lowlight"
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import go from "highlight.js/lib/languages/go"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

/**
 * 代码块高亮，**自己写而不是用 `rehype-highlight`**。
 *
 * 那个包在模块顶层写着 `import {common} from 'lowlight'`——
 * 35 种「常见」语言无条件进包，传 `languages` 选项只是往注册表上**再加**，
 * 减不掉已经打进去的那些。实测它让 vendor 块涨了 382 KB，
 * 而里面一多半（Perl、PHP、Objective-C…）在这个界面上一辈子不会出现。
 *
 * 自己走 lowlight 的话，打进去的就只有下面这张表。
 *
 * ⚠️ 仍然**不产出 HTML 字符串**：`lowlight.highlight()` 返回的是 hast 元素树，
 * 直接挂回文档树上。这和 `Markdown.tsx` 里那条「永远不要 `rehype-raw`」是同一条底线——
 * 安全性要来自结构，不是来自某个环节做对了转义。
 */
const lowlight = createLowlight({
  // typescript 一份覆盖 ts/js/tsx/jsx，xml 覆盖 html
  typescript,
  json,
  bash,
  python,
  rust,
  go,
  css,
  xml,
  yaml,
  sql,
  diff,
  markdown,
})

/** 语言别名 → 注册名。模型写 `ts`/`js`/`sh` 的频率远高于写全名。 */
const ALIAS: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  jsx: "typescript",
  javascript: "typescript",
  mjs: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rs: "rust",
  golang: "go",
  html: "xml",
  svg: "xml",
  yml: "yaml",
  md: "markdown",
  postgres: "sql",
}

interface HastNode {
  type: string
  tagName?: string
  properties?: { className?: unknown }
  value?: string
  children?: HastNode[]
}

function languageOf(node: HastNode): string | undefined {
  const className = node.properties?.className
  const names = Array.isArray(className) ? className : []
  for (const name of names) {
    if (typeof name !== "string" || !name.startsWith("language-")) continue
    const raw = name.slice("language-".length).toLowerCase()
    const resolved = ALIAS[raw] ?? raw
    if (lowlight.registered(resolved)) return resolved
  }
  return undefined
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map(textOf).join("")
}

function walk(node: HastNode): void {
  for (const child of node.children ?? []) {
    // 只认 `pre > code`，行内 code 不高亮——一句话里插一段彩色反而更难读
    if (child.tagName === "pre") {
      const code = (child.children ?? []).find((c) => c.tagName === "code")
      const language = code === undefined ? undefined : languageOf(code)
      if (code !== undefined && language !== undefined) {
        const tree = lowlight.highlight(language, textOf(code)) as unknown as HastNode
        code.children = tree.children ?? []
        continue
      }
    }
    walk(child)
  }
}

/**
 * rehype 插件。**没标语言就不猜**——`lowlight.highlightAuto` 猜错的高亮
 * 比没有高亮更碍眼，而模型标语言的比例本来就很高。
 */
export function rehypeHighlight() {
  return (tree: HastNode): void => {
    walk(tree)
  }
}
