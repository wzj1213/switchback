import { useState } from "react"
import type { Command, EngineInfo, ThreadId, Trust } from "@omni/protocol"
import type { Project } from "@omni/store"

/**
 * 在手机上开一条新会话。
 *
 * ## 为什么这一屏原来没有（那个理由是错的）
 *
 * 上一版把它写进「不拥有什么」，理由是「新建要选工作区目录，而目录选择器
 * 在桌面那侧（走系统对话框），手机上没有等价物——一个让你手打绝对路径的
 * 输入框比没有更糟」。
 *
 * **前半句对，结论错了。** 手机确实不该有文件浏览器，但它压根不需要：
 * 每条会话都带着自己的 `cwd`，**你已经在用的那些项目就是那份清单**。
 * 人在外面想开的新会话，几乎必然是在一个已经在弄的项目里——
 * 而「开一个全新目录」本来就该在有键盘和文件系统的那台机器上做。
 *
 * ## 档位不给选
 *
 * 远程有上限（默认「自动审批」），选了也会被服务端钳回去。摆一个点了
 * 会被悄悄改掉的选择器，比不摆更糟——所以这里直接用上限那一档，
 * 并且把它写在屏幕上。
 */
export function NewThread({
  projects,
  engines,
  maxTrust,
  hydrated,
  offline,
  onCreate,
  onCancel,
}: {
  projects: readonly Project[]
  engines: readonly EngineInfo[]
  /** 远程档位上限。开出来的会话就是这一档，屏幕上要说明白。 */
  maxTrust: string
  /** 基线到了没有。**没到 ≠ 一个项目都没有**。 */
  hydrated: boolean
  offline: boolean
  onCreate: (command: Extract<Command, { type: "thread.create" }>) => boolean
  onCancel: () => void
}): React.JSX.Element {
  const usable = engines.filter((e) => e.state !== "missing" && e.state !== "unavailable")
  const [cwd, setCwd] = useState(projects[0]?.cwd ?? "")
  const [engine, setEngine] = useState(usable[0]?.id ?? "")

  if (projects.length === 0) {
    // **「还没到」和「真的没有」必须分开。** 从锁屏点通知进来的第一秒，
    // 全量还在路上，`projects` 必然是空的——这时候说「还没有可用的项目」
    // 是一句确定的假话，而人看完就退出了，以为手机上开不了。
    // 这和列表那边用骨架修掉的是同一类错误
    const why = hydrated
      ? "还没有可用的项目。到桌面上开第一条会话，这里就能接着开了。"
      : "正在取项目清单…"
    return (
      <section className="newthread">
        <Head onCancel={onCancel} />
        <p className="empty">{why}</p>
      </section>
    )
  }

  return (
    <section className="newthread">
      <Head onCancel={onCancel} />
      <div className="newthread__body">
        <p className="newthread__label">在哪个项目</p>
        <ul className="newthread__list">
          {projects.map((p) => (
            <li key={p.cwd}>
              <button className="pick" type="button" aria-current={p.cwd === cwd} onClick={() => { setCwd(p.cwd) }}>
                <span className="pick__name">{p.name}</span>
                {/* 同名不同路径是两个项目，所以整条路径也要能看见 */}
                <span className="pick__path">{p.cwd}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="newthread__label">用哪家引擎</p>
        <ul className="newthread__list newthread__list--row">
          {usable.map((e) => (
            <li key={e.id}>
              <button className="pick pick--chip" type="button" aria-current={e.id === engine} onClick={() => { setEngine(e.id) }}>
                {e.label}
              </button>
            </li>
          ))}
        </ul>

        <p className="newthread__note">
          开出来是「{maxTrust}」档——这是远程的上限，改档位要去桌面上。
        </p>
      </div>
      <footer className="newthread__foot">
        {/* **断线时禁掉并改文案。** 亮着的话按下去毫无反应（`send` 返回 false），
            人只会连按四次——和 `Reattach` 那边同一个做法 */}
        <button
          className="btn btn--primary newthread__go"
          type="button"
          disabled={offline || cwd === "" || engine === ""}
          onClick={() => {
            onCreate({ type: "thread.create", cwd, engine, trust: maxTrust as Trust })
          }}
        >
          {offline ? "等重连…" : "开一条"}
        </button>
      </footer>
    </section>
  )
}

function Head({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  return (
    <header className="threads__head">
      <button className="btn btn--ghost thread__back" type="button" onClick={onCancel} aria-label="返回列表">
        ‹
      </button>
      <span className="threads__title">新会话</span>
    </header>
  )
}

/** 新建之后要选中哪条：宿主建好会发 `thread.started`，由调用方接。 */
export type Created = (id: ThreadId) => void
