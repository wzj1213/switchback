/// <reference types="vite/client" />

/*
 * 三份手抄的跨进程形状（`Sealed` / `Settings` / `Replay`）已经删掉。
 * 它们当初的注释写着「跨进程的形状只能靠约定对齐」——那句话本身就是问题：
 * 靠约定对齐 = 没有任何东西在对齐失败时报错。现在全部从 preload 的真实导出走。
 */
import type { SwitchbackBridge } from "../preload/index.js"
declare global {
  interface Window {
    /**
     * preload 注入的窄通道。
     *
     * **类型从 preload 的真实导出推导，不再手写一份。**
     * 原来这里是一份手抄的接口，于是它可以和实现对不上而编译器一言不发——
     * 实测踩过：`chatDir` 和 `stashImage` 写进了这份声明、却没进 preload，
     * `pnpm check` 全绿，跑起来才 `is not a function`。
     * 现在少写一个方法会在**用它的地方**编译不过。
     *
     * `undefined` 是真实可能：preload 没注入时（打包出错、被安全策略拦掉）
     * 它就是没有。见 `useSwitchback` 的 `bridgeMissing`。
     */
    switchback?: SwitchbackBridge
  }
}

export {}
