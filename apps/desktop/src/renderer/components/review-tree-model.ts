import type { ReviewFile } from "../../shared/review.js"
import { splitPath } from "../diff.js"

interface DirectoryNode {
  kind: "directory"
  label: string
  path: string
  children: TreeNode[]
}

interface FileNode {
  kind: "file"
  file: ReviewFile
}

type TreeNode = DirectoryNode | FileNode

export interface ReviewTreeRow {
  key: string
  kind: "directory" | "file"
  label: string
  depth: number
  parent: string | undefined
  expanded?: boolean
  file?: ReviewFile
  path?: string
}

function directory(nodes: TreeNode[], label: string, path: string): DirectoryNode {
  const found = nodes.find((node): node is DirectoryNode =>
    node.kind === "directory" && node.path === path)
  if (found !== undefined) return found
  const created: DirectoryNode = { kind: "directory", label, path, children: [] }
  nodes.push(created)
  return created
}

interface InsertCursor {
  parts: readonly string[]
  at: number
  prefix: string
}

function insert(nodes: TreeNode[], file: ReviewFile, cursor: InsertCursor): void {
  const label = cursor.parts[cursor.at]
  if (label === undefined) return
  if (cursor.at === cursor.parts.length - 1) {
    nodes.push({ kind: "file", file })
    return
  }
  const path = cursor.prefix === "" ? label : `${cursor.prefix}/${label}`
  insert(directory(nodes, label, path).children, file,
    { ...cursor, at: cursor.at + 1, prefix: path })
}

function compact(node: DirectoryNode): DirectoryNode {
  const only = node.children.length === 1 ? node.children[0] : undefined
  if (only?.kind !== "directory") {
    return { ...node, children: node.children.map(compactNode) }
  }
  return compact({ kind: "directory", label: `${node.label}/${only.label}`,
    path: only.path, children: only.children })
}

function compactNode(node: TreeNode): TreeNode {
  return node.kind === "directory" ? compact(node) : node
}

function sortTree(nodes: readonly TreeNode[]): readonly TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1
    const aName = a.kind === "directory" ? a.label : a.file.rel
    const bName = b.kind === "directory" ? b.label : b.file.rel
    return aName.localeCompare(bName)
  }).map((node) => node.kind === "directory"
    ? { ...node, children: [...sortTree(node.children)] } : node)
}

function tree(files: readonly ReviewFile[]): readonly TreeNode[] {
  const nodes: TreeNode[] = []
  for (const file of files) insert(nodes, file, { parts: file.rel.split("/"), at: 0, prefix: "" })
  return sortTree(nodes.map(compactNode))
}

interface FlattenCursor {
  closed: ReadonlySet<string>
  depth: number
  parent: string | undefined
}

function flatten(nodes: readonly TreeNode[], cursor: FlattenCursor): readonly ReviewTreeRow[] {
  return nodes.flatMap((node): readonly ReviewTreeRow[] => {
    if (node.kind === "file") {
      const { name } = splitPath(node.file.rel)
      return [{ key: `file:${node.file.rel}`, kind: "file", label: name,
        depth: cursor.depth, parent: cursor.parent, file: node.file }]
    }
    const hidden = cursor.closed.has(node.path)
    const row: ReviewTreeRow = { key: `dir:${node.path}`, kind: "directory",
      label: node.label, depth: cursor.depth, parent: cursor.parent,
      path: node.path, expanded: !hidden }
    return hidden ? [row] : [row, ...flatten(node.children,
      { ...cursor, depth: cursor.depth + 1, parent: node.path })]
  })
}

export function reviewTreeRows(files: readonly ReviewFile[],
  closed: ReadonlySet<string>): readonly ReviewTreeRow[] {
  return flatten(tree(files), { closed, depth: 1, parent: undefined })
}

export function revealReviewTreePath(closed: ReadonlySet<string>, active: string | undefined):
ReadonlySet<string> {
  if (active === undefined) return closed
  const next = new Set([...closed].filter((path) => !active.startsWith(`${path}/`)))
  return next.size === closed.size ? closed : next
}

export function reviewTreeDestination(key: string, at: number,
  rows: readonly ReviewTreeRow[]): number | "toggle" | undefined {
  const row = rows[at]
  if (row === undefined) return undefined
  if (key === "Home") return 0
  if (key === "End") return rows.length - 1
  if (key === "ArrowUp") return Math.max(0, at - 1)
  if (key === "ArrowDown") return Math.min(rows.length - 1, at + 1)
  if (key === "ArrowRight" && row.kind === "directory") {
    return row.expanded === true ? Math.min(rows.length - 1, at + 1) : "toggle"
  }
  if (key !== "ArrowLeft") return undefined
  if (row.kind === "directory" && row.expanded === true) return "toggle"
  return rows.findIndex((candidate) => candidate.path === row.parent)
}
