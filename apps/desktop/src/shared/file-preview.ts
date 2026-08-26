export interface FilePreviewRequest {
  /** 哪条会话在看。工作区外的文件只有这条会话读过时才放行（见 `main/touched.ts`）。 */
  threadId: string
  cwd: string
  path: string
}

interface PreviewBase {
  path: string
  name: string
}

export type FilePreview =
  | (PreviewBase & {
      kind: "text"
      text: string
      language?: string
      truncated: boolean
    })
  | (PreviewBase & {
      kind: "html"
      text: string
      language?: string
      truncated: boolean
    })
  | (PreviewBase & { kind: "image"; dataUrl: string })
  | (PreviewBase & {
      kind: "unavailable"
      reason: "outside" | "missing" | "directory" | "binary" | "failed"
      message: string
    })
