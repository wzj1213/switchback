import { randomUUID } from "node:crypto"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * ACP 的 terminal 型登录：在「终端」里跑引擎**自己的**登录界面。
 *
 * ## 为什么是打开系统终端，而不是在 Switchback 里嵌一个
 *
 * 协议要的只是「一个能交互的终端」，退出码 0 即成功；Switchback 没有内置终端，
 * 为一年登录几次的事塞一个原生 pty 模块进包里不划算。macOS 上双击 `.command`
 * 文件就是「在终端里跑这个脚本」——不需要辅助功能或自动化权限，也不用 AppleScript。
 *
 * ## 脚本长什么样
 *
 * - 第一行就把自己删掉：它里面可能有 `engines.json` 的 `env`（可能是 key），
 *   不该在盘上多留一秒；终端读进去之后文件在不在都不影响执行。
 * - PATH 用 Switchback 此刻的那一份（启动时从登录 shell 补齐过）：「终端」自己的环境
 *   不一定找得到 `npx` / `node`，而这正是引擎在 Switchback 里跑时用的那一份。
 * - 命令与参数逐个单引号转义，不经过任何字符串拼接的 shell 解释。
 */
export interface TerminalLogin {
  label: string
  command: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  cwd: string
  path: string
}

/** 单引号转义：`'` → `'\''`。**只有这一种写法在 sh 里对任何字节都安全。** */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

const SAFE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/u

export function loginScriptOf(login: TerminalLogin): string {
  const exports = Object.entries({ PATH: login.path, ...login.env })
    .filter(([key]) => SAFE_ENV.test(key))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
  const line = [login.command, ...login.args].map(shellQuote).join(" ")
  return [
    "#!/bin/sh",
    'rm -f -- "$0"',
    ...exports,
    `cd ${shellQuote(login.cwd)} || exit 1`,
    `printf '%s\\n\\n' ${shellQuote(`Switchback：下面是 ${login.label} 自己的登录流程。走完之后回到 Switchback，点「试接」确认。`)}`,
    line,
    "code=$?",
    "echo",
    `if [ "$code" -eq 0 ]; then echo ${shellQuote("登录流程已结束。可以关掉这个窗口，回到 Switchback。")}; else echo "登录流程以 $code 退出。"; fi`,
    "",
  ].join("\n")
}

/** 写脚本并交给系统打开。返回打开失败时的那句话（成功是 undefined）。 */
export async function openTerminalLogin(
  dir: string,
  login: TerminalLogin,
  open: (path: string) => Promise<string>,
): Promise<string | undefined> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `login-${randomUUID()}.command`)
  await writeFile(file, loginScriptOf(login), { encoding: "utf8", mode: 0o700 })
  await chmod(file, 0o700)
  const error = await open(file)
  return error === "" ? undefined : `没能打开「终端」：${error}`
}
