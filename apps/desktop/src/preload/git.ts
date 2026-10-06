import { ipcRenderer } from "electron"
import type { CommitResult, GitState } from "../shared/git.js"

/**
 * 审查页「提交」那一条的通道。只递会话 id、工作区和人写的东西（说明、相对路径），
 * 主进程按审核面板同一个守卫核对工作区归属——见 `main/git-channel.ts`。
 */
export const gitBridge = {
  async gitState(req: { threadId: string; cwd: string }): Promise<GitState> {
    return (await ipcRenderer.invoke("switchback:gitState", req)) as GitState
  },
  async gitCommit(req: { threadId: string; cwd: string; message: string; all: boolean }): Promise<CommitResult> {
    return (await ipcRenderer.invoke("switchback:gitCommit", req)) as CommitResult
  },
  async gitStage(req: { threadId: string; cwd: string; rel: string; stage: boolean }): Promise<CommitResult> {
    return (await ipcRenderer.invoke("switchback:gitStage", req)) as CommitResult
  },
  /** 撤销刚才那次提交（`full` 是它的完整哈希；HEAD 已经不是它就不撤）。 */
  async gitUndo(req: { threadId: string; cwd: string; full: string }): Promise<CommitResult> {
    return (await ipcRenderer.invoke("switchback:gitUndo", req)) as CommitResult
  },
}
