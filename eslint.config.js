import js from "@eslint/js"
import tseslint from "typescript-eslint"
import prettier from "eslint-config-prettier"

/** 模块级可变状态禁令 —— 上一版就是靠包级全局互相通信才耦合成一团。 */
const noModuleLevelMutableState = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "Program > VariableDeclaration[kind='let']",
      message: "禁止模块级 let：状态要显式传入，不要挂在模块上（见 AGENTS.md 反模式 2）",
    },
    {
      selector: "Program > VariableDeclaration[kind='var']",
      message: "禁止模块级 var",
    },
    {
      selector: "Program > ExportNamedDeclaration > VariableDeclaration[kind='let']",
      message: "禁止导出可变绑定",
    },
  ],
}

/** 纯逻辑包禁 IO —— 保证 protocol / approval 可被穷举测试。 */
const noIoInPurePackages = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        { group: ["node:*", "fs", "path", "child_process", "os"], message: "纯逻辑包禁止 IO" },
        { group: ["@omni/*/src/*", "@omni/*/dist/*"], message: "只能 import 包入口，不得深引用" },
      ],
    },
  ],
  "no-restricted-globals": [
    "error",
    { name: "process", message: "纯逻辑包禁止读环境" },
    { name: "fetch", message: "纯逻辑包禁止网络" },
  ],
  "no-restricted-properties": [
    "error",
    { object: "Date", property: "now", message: "纯逻辑包禁止读时钟：时间由调用方传入" },
    { object: "Math", property: "random", message: "纯逻辑包禁止随机：随机源由调用方传入" },
  ],
}

export default tseslint.config(
  // `.claude/` 是 Claude Code 的工作副本（含临时 worktree），已经不进版本库，
  // 也不该被这套闸门管——那里的东西不是这个产品的代码
  // `release/` 是打包产物（`.gitignore` 里也有它）。**以前不用写**：那儿只有
  // `app.asar` 一个二进制块，eslint 根本没有 .js 可扫；浏览器端进包之后那里多了
  // 散装的 `assets/*.js` 和 `sw.js`，于是 `pnpm check` 在**刚打过包的机器上**才会红，
  // 干净 checkout 上照样绿——这种「只在某些机器上红」的闸门最消耗信任
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      ".claude/**",
      ".tmp-*",
      ".tmp-*/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,

  // ── 全局规模闸门 ──────────────────────────────────────────────
  {
    files: ["**/*.{ts,tsx,mts,js,mjs}"],
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 12],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      eqeqeq: ["error", "always"],
      "no-console": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      ...noModuleLevelMutableState,
    },
  },

  // ── 纯逻辑包：额外禁 IO ────────────────────────────────────────
  {
    files: ["packages/protocol/**/*.ts", "packages/approval/**/*.ts"],
    rules: noIoInPurePackages,
  },

  // ── renderer：组件更严的文件上限，函数放宽 ───────────────────────
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        HTMLElement: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
    },
  },

  // ── 浏览器端：同 renderer 的尺度，外加浏览器全局 ──────────────────
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        WebSocket: "readonly",
        MessageEvent: "readonly",
        HTMLElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLInputElement: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        queueMicrotask: "readonly",
        navigator: "readonly",
      },
    },
    rules: {
      "max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
    },
  },

  // ── service worker：另一套全局，也没有 window ─────────────────
  {
    files: ["apps/web/public/*.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        URL: "readonly",
        console: "readonly",
        // 外壳缓存要用的那几样（`sw.js` 的 `install` / `fetch`）
        caches: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Promise: "readonly",
      },
    },
  },

  // ── main 进程与脚本：允许 IO 与 console ─────────────────────────
  {
    files: [
      "apps/desktop/src/main/**/*.ts",
      "apps/desktop/src/preload/**/*.ts",
      // 开发/验收台。跑在 Node 里、靠 console 说话，和 main 同一套尺度
      "apps/desktop/harness/**/*.ts",
      "scripts/**/*.mjs",
    ],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        __dirname: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },

  // ── 测试：放宽长度，其余照旧 ────────────────────────────────────
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "no-restricted-properties": "off",
    },
  },

  prettier,
)
