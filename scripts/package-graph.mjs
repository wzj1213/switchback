/**
 * 工作区允许的精确依赖边。文档与守卫都以这里为真源。
 *
 * 列出来的就是 package.json 必须逐条相等的实际边；新增或删除依赖都必须同步改图。
 */
export const PACKAGE_GRAPH = Object.freeze({
  "@switchback/protocol": Object.freeze([]),
  "@switchback/approval": Object.freeze(["@switchback/protocol"]),
  "@switchback/store": Object.freeze(["@switchback/protocol"]),
  "@switchback/wire": Object.freeze(["@switchback/protocol"]),
  "@switchback/link": Object.freeze(["@switchback/protocol", "@switchback/wire"]),
  "@switchback/worksite": Object.freeze([]),
  "@switchback/i18n": Object.freeze([]),
  "@switchback/journal": Object.freeze(["@switchback/protocol"]),
  "@switchback/handoff": Object.freeze(["@switchback/protocol"]),
  "@switchback/engine": Object.freeze(["@switchback/protocol", "@switchback/approval"]),
  "@switchback/host": Object.freeze([
    "@switchback/protocol",
    "@switchback/approval",
    "@switchback/engine",
    "@switchback/store",
    "@switchback/journal",
    "@switchback/handoff",
  ]),
  "@switchback/desktop": Object.freeze([
    "@switchback/protocol",
    "@switchback/engine",
    "@switchback/handoff",
    "@switchback/host",
    "@switchback/i18n",
    "@switchback/journal",
    "@switchback/link",
    "@switchback/store",
    "@switchback/wire",
    "@switchback/worksite",
  ]),
  "@switchback/web": Object.freeze([
    "@switchback/link",
    "@switchback/protocol",
    "@switchback/store",
    "@switchback/wire",
  ]),
})

const short = (name) => name.slice("@switchback/".length)

export function renderPackageGraph() {
  return Object.entries(PACKAGE_GRAPH)
    .map(
      ([name, dependencies]) =>
        `${short(name)} ← ${dependencies.length === 0 ? "∅" : dependencies.map(short).join(" + ")}`,
    )
    .join("\n")
}
