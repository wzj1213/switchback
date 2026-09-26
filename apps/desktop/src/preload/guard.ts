import { ipcRenderer } from "electron"
import type { GuardReport } from "../shared/guard.js"

/** 设置页「外发守卫」那一组用的通道。只读：停不停、锁不锁都走设置本身。 */
export const guardBridge = {
  /** 每个引擎进程这次启动以来往外发了多少，和 ZCode 的防护状态。 */
  async guard(): Promise<GuardReport> {
    return (await ipcRenderer.invoke("omni:guard")) as GuardReport
  },
}
