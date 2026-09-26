/**
 * 外发守卫与 ZCode 防护报给设置页的东西。主进程产出（`main/egress-*.ts`、`main/zcode-guard.ts`），
 * 渲染层只读。放在 shared 是因为两边都要这个形状。
 */

/** 一个进程树这次启动以来的外发账。设置页「外发记录」读的就是它。 */
export interface EgressRecord {
  key: string
  label: string
  /** 组长 pid。可以拿去「活动监视器」里对一下。 */
  leader: number
  threads: readonly string[]
  /** 它自己发出、收到的字节。 */
  sent: number
  received: number
  /** 它跑的命令发出的字节（`git push` 之类）。 */
  toolSent: number
  /** 任意一分钟里它自己发得最多的那一分钟。 */
  peak: number
  since: number
  last: number
}

export interface ZcodeStatus {
  /** 装着的桌面端在哪儿。没装就是 undefined。 */
  app: string | undefined
  version: string | undefined
  /** 这一版有没有那个问题：比 3.14.0 旧。读不出版本也算有（宁可多提醒）。 */
  affected: boolean
  checkpoints: {
    path: string
    exists: boolean
    locked: boolean
    /** 还躺在里面、没传出去的加密包（`.enc`）。 */
    archives: number
    bytes: number
  }
}

export interface GuardReport {
  records: readonly EgressRecord[]
  zcode: ZcodeStatus
}
