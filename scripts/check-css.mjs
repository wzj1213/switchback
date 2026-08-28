#!/usr/bin/env node
/**
 * 样式守卫 —— 挡住「组件在用、样式却没了」。
 * 用法：node scripts/check-css.mjs
 *
 * ## 为什么要这一条
 *
 * CSS 没有类型系统：**删掉一条规则、或者在合并里丢掉一整段，不会有任何东西报错**。
 * 组件照常渲染，只是元素变成裸的。两次真事：
 *
 * 1. `.turnmark__act`（「从这里重来」）的基础样式一直和另一个块的类
 *    **共用一个选择器组**。清理时删掉了那个类，这颗按钮就被扒光了——
 *    退化成一颗带边框、会折成两行的浏览器默认按钮。
 * 2. 远程面板那 95 行（`.pairing` / `.devices` / `.set__code` …）在一次合并里
 *    被整段丢掉：解冲突时整份取了另一边。`RemotePanel` 在 main 上渲染成
 *    一堆无样式的裸元素，**没有任何测试或类型检查会发现**。
 *
 * ## 判据
 *
 * 组件里 `className` 用到的每一个类，**至少要有一条 CSS 规则提到它**。
 * 只查「有没有」，不查「够不够」——后者机械判不了（见文件末尾那段说明）。
 *
 * 模板字符串里 `${}` 拼出来的那一半会被丢掉：`rvl__kind--${kind}` 里的
 * `rvl__kind--` 是个前缀不是类名，认它只会造出永远修不掉的假阳性。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** 各端各算各的：一端的组件不该指望另一端的样式表。 */
const ENDS = [
  { name: "desktop", styles: join(ROOT, "apps/desktop/src/renderer/styles"), code: join(ROOT, "apps/desktop/src/renderer") },
  { name: "web", styles: join(ROOT, "apps/web/src"), code: join(ROOT, "apps/web/src") },
]

/**
 * **有意不带样式的语义钩子。**
 *
 * 它们靠父级或同元素上的另一个类拿到全部外观，自己只是个名字（给读代码的人、
 * 或者给将来的选择器留的把手）。列在这里是**主动声明**，不是豁免——
 * 新增一个就得在这儿写清楚为什么，那正是这条守卫想逼出来的那一次思考。
 */
const INTENTIONAL = new Map([
  ["hk", "环境页的 BEM 块根，外观全在 .hk__* 上"],
  ["changed__file", "一个文件一组的包裹层，行距由里面的 .changed__row 定"],
  ["meter__label", "父级 .meter 已经给了字号与颜色，它只是个名字"],
  ["step__verb", "父级 .step 是 flex 行，动词继承它的字号与颜色"],
  ["row__rename", "和 .row__label 同挂，外观全在后者"],
  ["sidebar__section-act", "和 .row__act 同挂，外观全在后者"],
  ["row--flat", "侧栏行的语义标记（flat = 上面没有项目行）；曾经有缩进规则，撤缩进后只剩名字"],
  ["step--expanded", "只作状态标记，展开态的外观由 .step--open 与子元素表达"],
  ["item--agent", "浏览器端：agent 的话就是默认排版，.item 已经给完；用户那条才需要 .item--user 靠右"],
  ["item--reasoning", "浏览器端：外观全在 .fold 与 .reasoning__text 上"],
])

/** 选择器里出现过的类名（不管在哪一层、哪种组合里）。 */
function classesInStyles(dir) {
  const found = new Set()
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
    const text = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    // 只看 `{` 之前那一段：声明里也可能出现 `.` 开头的东西（url、content）
    for (const chunk of text.split("{")) {
      const selector = chunk.split("}").pop() ?? ""
      for (const m of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(m[1])
    }
  }
  return found
}

/** 递归收 tsx/ts。 */
function sources(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(path)
  }
  return out
}

/**
 * 一次 `className` 里静态写死的那些类。
 *
 * `${...}` 整段替换成空格：紧挨着它的那个词是**拼接出来的前缀**（`a--${kind}`），
 * 不是一个真的类名。前后被切开的残片靠「不以 `-` 结尾」这条挡掉。
 */
function classesInAttr(raw) {
  return raw
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/[\s"'`]+/)
    .map((t) => t.trim())
    .filter((t) => /^[a-zA-Z][\w-]*$/.test(t) && !t.endsWith("-"))
}

function audit(end) {
  const defined = classesInStyles(end.styles)
  const missing = []
  for (const path of sources(end.code)) {
    const text = readFileSync(path, "utf8")
    const lines = text.split("\n")
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const cls of classesInAttr(m[1] ?? m[2] ?? "")) {
          if (defined.has(cls) || INTENTIONAL.has(cls)) continue
          missing.push(`${relative(ROOT, path)}:${i + 1} 用了 .${cls}，但 ${end.name} 的样式表里一条规则都没有`)
        }
      }
    })
  }
  return { defined, missing }
}

function main() {
  const results = ENDS.map(audit)
  const missing = results.flatMap((r) => r.missing)
  if (missing.length > 0) {
    console.error(`\n样式守卫失败（${String(missing.length)} 处）：\n`)
    for (const m of [...new Set(missing)]) console.error(`  ✗ ${m}`)
    console.error(
      "\n提示：CSS 里少一条规则不会报错，元素只是变成裸的。" +
        "\n确实不需要样式的话，把它写进 scripts/check-css.mjs 的 INTENTIONAL 并说明理由。\n",
    )
    process.exit(1)
  }
  const n = results.reduce((sum, r) => sum + r.defined.size, 0)
  console.log(
    `样式守卫通过：${String(ENDS.length)} 端 / ${String(n)} 个类有规则，` +
      `组件里用到的类全部有样式（${String(INTENTIONAL.size)} 个已声明为语义钩子）`,
  )
}

main()

/*
 * ## 这条守卫**抓不到**什么
 *
 * 「有规则」不等于「样式还完整」。`.turnmark__act` 被扒光的那次，它身上还剩
 * 两条 `opacity` 规则——按这条判据是合格的，而它已经变成一颗裸按钮了。
 * 要抓那种得判「基础样式够不够」，而「够」是没法机械定义的：
 * 一个只有 `animation` 的类可能完全正确（`.blank__glyph--spin`）。
 *
 * 所以那一半靠的是别的东西：把同类动作收进一个共用类（`.act`），
 * 而不是让每个组件的类各自散着、靠共用选择器捎带。
 */
