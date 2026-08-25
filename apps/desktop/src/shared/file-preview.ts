export interface FilePreviewRequest {
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
