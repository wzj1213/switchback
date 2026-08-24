import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DshPet } from "./dsh-art.js"

const PETS_CSS = readFileSync(new URL("../styles/pets.css", import.meta.url), "utf8")

describe("DshPet", () => {
  it("保留原尺寸眼睛，并把可动眼层盖在补平的眼洞上", () => {
    const markup = renderToStaticMarkup(createElement(DshPet))
    const boxes = [...markup.matchAll(/x="(37|60)" y="42" width="11" height="22"/g)]
    const eyeStart = markup.indexOf('<g class="pet__eyes"')
    const eyeLayer = markup.slice(eyeStart, markup.indexOf("</g>", eyeStart))

    expect(boxes.map((match) => match[1])).toEqual(["37", "60", "37", "60"])
    expect(eyeLayer).toContain('fill="var(--pet-dsh-eye)"')
    expect(eyeLayer).toContain('rx="3"')
    expect(eyeLayer).not.toContain("mask=")
    expect(markup).toContain('mask="url(#dsh-reference-light-mask)"')
  })

  it("左右注视各移动两个最终渲染像素", () => {
    expect(PETS_CSS).toMatch(/\.pet--dsh-mark\.pet--look-l \.pet__eyes \{\s+transform: translateX\(-2px\)/)
    expect(PETS_CSS).toMatch(/\.pet--dsh-mark\.pet--look-r \.pet__eyes \{\s+transform: translateX\(2px\)/)
  })
})
