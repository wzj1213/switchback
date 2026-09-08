#!/usr/bin/env node
/**
 * 图标守卫 —— 挡住「自己写 `<svg>`，绕过笔画补偿」。
 * 用法：node scripts/check-icons.mjs
 *
 * ## 为什么要这一条
 *
 * `icon-base.tsx` 的 `Svg` 按渲染尺寸反向补偿 `strokeWidth`
 *（`1.25 × 16 / size`），让整套图标**不管画多大，落到屏幕上永远是 1.25px**。
 * 那套补偿本身就是为了修一个已经发生过的毛病——它的注释里记着：
 * 「侧栏那一列里 14 和 12 是挨着的，**笔画差 28%**，看起来就是有的粗有的细」。
 *
 * 修完之后，同一个毛病**在别处又长回来了八次**。2026-08-26 实测：
 *
 * | 位置 | 尺寸 | 写死 | 实际笔画 | 相对 1.25 |
 * | --- | --- | --- | --- | --- |
 * | `PlanMark.tsx` 计划步态环 | 11 | 1.35 | 0.93 | **−26%** |
 * | `PanelTabs.tsx` 全屏 | 12 | 1.5 | 1.13 | −10% |
 * | `review.css` 审核四枚 + 跳转 | 14 | 1.35 | 1.18 | −6% |
 * | `PanelTabs.tsx` 侧边面板 | 13 | 1.5 | 1.22 | −2% |
 * | `attachment-pick.tsx` 回形针 | 14 | 1.45 | 1.27 | +2% |
 * | `TopBarActions.tsx` 侧边面板 | 14 | 1.5 | 1.31 | **+5%** |
 *
 * 最粗与最细差 41%，而最要命的一对是**并排的**：工作台右上角的「全屏」
 * 和顶栏的「侧边面板」挨着，差 16%。
 *
 * 这类偏差**眼睛在 13px 下判不出来**——只会觉得那一排「有点脏」。
 * 判不出来的东西就该由 CI 判。
 *
 * ## 判据
 *
 * 1. renderer 的 `.tsx` 里不许出现 `<svg` 或 `strokeWidth=`（豁免见下）。
 * 2. renderer 的 `.css` 里不许出现 `stroke-width:`——那是 `Svg` 的职责，
 *    写在 CSS 里等于从另一条路绕过补偿。
 * 3. 文字关闭键：不许拿 `×`(U+00D7) / `✕`(U+2715) 当按钮内容。
 *    文字按**基线**排版，而它们都装在居中的方盒子里——盒子居中的是行盒不是字形，
 *    于是每一颗都比看起来该在的位置偏一点，偏多少还跟着字号变。
 *    用 `CloseIcon`（`icons-panel.tsx`）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const RENDERER = join(ROOT, "apps/desktop/src/renderer")

/**
 * **真正的插画，不是图标。**
 *
 * 它们画的是一个形象或一段渐变，不受「整套 1.25px」约束——那条约束的意义是
 * 「同一列里的图标看起来一样重」，而这几个从来不和图标同列。
 * 新增一个就得写清楚为什么，那正是这条守卫想逼出来的那一次思考。
 */
const ILLUSTRATIONS = new Map([
  ["components/icon-base.tsx", "补偿算法本体，`<svg>` 是它的产物"],
  ["components/pets-art.tsx", "桌宠形象：逐格写死的像素画，没有描边"],
  ["components/dsh-art.tsx", "DSH 形象：同上"],
  ["components/UsageRing.tsx", "用量环：半径与弧长按数据算，不是固定形"],
  ["components/PetFxCanvas.tsx", "桌宠特效画布"],
])

/** CSS 里允许出现 stroke-width 的地方。同上，写清楚为什么。 */
const CSS_ALLOW = new Map([
  ["styles/usage.css", "用量环：半径与弧长按数据算的一段弧，不是固定形的图标（同 UsageRing.tsx）"],
])

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === "node_modules") return []
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/**
 * **先去掉注释再判。** 这份守卫自己的说明里就写着「不许出现 `<svg`」，
 * 而讲清楚为什么，就不得不把那几个字打出来——第一次跑它逮的正是自己。
 * 同一个坑还会落到 `icons-panel.tsx` 与 `review.css` 的说明上：
 * 它们必须记着「改之前写死的是 1.35」，否则下一个人不知道这条规矩在修什么。
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "")
}

const problems = []
for (const path of walk(RENDERER)) {
  const rel = relative(RENDERER, path)
  const text = stripComments(readFileSync(path, "utf8"))
  if (path.endsWith(".tsx")) {
    if (ILLUSTRATIONS.has(rel)) continue
    if (/<svg[\s>]/u.test(text)) {
      problems.push(`${rel}：自己写了 <svg>。用 icon-base.tsx 的 Svg，它按尺寸补偿笔画`)
    }
    if (/strokeWidth=/u.test(text)) {
      problems.push(`${rel}：写死了 strokeWidth。那一项由 Svg 按尺寸算，写死等于绕过补偿`)
    }
    if (/[>{]\s*["'`]?[×✕]["'`]?\s*[<}]/u.test(text)) {
      problems.push(`${rel}：拿 × / ✕ 当按钮内容。用 icons-panel.tsx 的 CloseIcon`)
    }
  } else if (path.endsWith(".css") && /stroke-width\s*:/u.test(text)) {
    if (CSS_ALLOW.has(rel)) continue
    problems.push(`${rel}：CSS 里写了 stroke-width。那是 Svg 的职责，写在这里等于从另一条路绕过补偿`)
  }
}

if (problems.length > 0) {
  console.error(["图标守卫失败：", ...problems.map((one) => `  ${one}`)].join("\n"))
  process.exitCode = 1
} else {
  console.log(
    `图标守卫通过：renderer 下没有绕过 Svg 的图标（${String(ILLUSTRATIONS.size)} 个插画、${String(CSS_ALLOW.size)} 处 CSS 已声明豁免）`,
  )
}
