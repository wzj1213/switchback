/** 启动阶段的 RPC 要同时和进程退出、截止时间赛跑。 */
export type StartupRace<T> =
  | { kind: "ready"; value: T }
  | { kind: "died"; error: Error }
  | { kind: "timeout" }

/**
 * timer 在任一分支先落定后立刻清掉；否则一次成功开场会让测试进程多活二十秒。
 * `task` 自己 reject 时保持原错误，不在这里改写 app-server 的诊断。
 */
export async function raceStartup<T>(
  task: Promise<T>,
  died: Promise<Error>,
  timeoutMs: number,
): Promise<StartupRace<T>> {
  const timer: { handle: ReturnType<typeof setTimeout> | undefined } = { handle: undefined }
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer.handle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  try {
    return await Promise.race([
      task.then((value) => ({ kind: "ready", value }) as const),
      died.then((error) => ({ kind: "died", error }) as const),
      timeout,
    ])
  } finally {
    if (timer.handle !== undefined) clearTimeout(timer.handle)
  }
}
