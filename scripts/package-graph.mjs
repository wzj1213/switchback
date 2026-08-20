/**
 * 工作区允许的精确依赖边。文档与守卫都以这里为真源。
 *
 * 列出来的就是 package.json 必须逐条相等的实际边；新增或删除依赖都必须同步改图。
 */
export const PACKAGE_GRAPH = Object.freeze({
  "@omni/protocol": Object.freeze([]),
  "@omni/approval": Object.freeze(["@omni/protocol"]),
  "@omni/store": Object.freeze(["@omni/protocol"]),
  "@omni/wire": Object.freeze(["@omni/protocol"]),
  "@omni/worksite": Object.freeze([]),
  "@omni/journal": Object.freeze(["@omni/protocol"]),
  "@omni/handoff": Object.freeze(["@omni/protocol"]),
  "@omni/engine": Object.freeze(["@omni/protocol", "@omni/approval"]),
  "@omni/host": Object.freeze([
    "@omni/protocol",
    "@omni/approval",
    "@omni/engine",
    "@omni/store",
    "@omni/journal",
    "@omni/handoff",
  ]),
  "@omni/desktop": Object.freeze([
    "@omni/protocol",
    "@omni/engine",
    "@omni/handoff",
    "@omni/host",
    "@omni/journal",
    "@omni/store",
    "@omni/wire",
    "@omni/worksite",
  ]),
  "@omni/web": Object.freeze(["@omni/protocol", "@omni/store", "@omni/wire"]),
})

const short = (name) => name.slice("@omni/".length)

export function renderPackageGraph() {
  return Object.entries(PACKAGE_GRAPH)
    .map(
      ([name, dependencies]) =>
        `${short(name)} ← ${dependencies.length === 0 ? "∅" : dependencies.map(short).join(" + ")}`,
    )
    .join("\n")
}
