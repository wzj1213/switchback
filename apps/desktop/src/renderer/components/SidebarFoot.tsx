import { useRef, useState } from "react"
import { FileIcon } from "./icons-activity.js"
import { GearIcon } from "./icons.js"
import { Popover } from "./Popover.js"
import { UpdateButton } from "./UpdateButton.js"

/**
 * 侧栏最底下**那一行**。
 *
 * ## 为什么是一行，不是三行
 *
 * 上一版是三行堆叠：更新、账号、设置。三行等重、等宽、等间距——
 * 于是**你要找的那一行和你不找的那两行长得一模一样**，眼睛没有落点。
 * 更糟的是它们的性质完全不同：设置是天天点的入口，账号是不可点的身份，
 * 更新是偶尔冒出来的一次性动作。把三种东西排成一列，等于说它们一样重要。
 *
 * 现在：**左边是你是谁**（点开才有菜单），**右边只留一颗按钮**，
 * 而那颗按钮平时根本不在——只有真有新代码时才出现（见 `UpdateButton`）。
 * 常态下这一行只有一件事：一个头像、一个名字。
 *
 * ## 没有账号时这一行说什么
 *
 * 引擎没报账号（不是每家都报）时不摆一个空头像——那一行改成「设置」本身，
 * 点了直接开设置。**一行只做一件事**：有身份时它是身份，没身份时它是入口。
 */

export interface AccountLine {
  /** 邮箱或用户名。 */
  label: string
  /** 套餐，比如 `prolite`。报不上来就缺席。 */
  plan?: string
  /** 还剩百分之几。报不上来就缺席——**不显示成 100%**，那是撒谎。 */
  remain?: number
}

export function SidebarFoot({
  account,
  onOpenSettings,
}: {
  account: AccountLine | undefined
  onOpenSettings: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = (): void => {
    setOpen(false)
  }
  return (
    <div className="foot">
      <button
        type="button"
        ref={trigger}
        className={`foot__who${open ? " foot__who--open" : ""}`}
        // 没有账号时这一行**就是**设置，点了直接开——不弹一个只有一项的菜单
        title={account === undefined ? "设置" : hoverOf(account)}
        {...(account === undefined
          ? {}
          : { "aria-haspopup": "menu" as const, "aria-expanded": open })}
        onClick={() => {
          if (account === undefined) onOpenSettings()
          else setOpen((was) => !was)
        }}
      >
        {/* 头像和齿轮共用同一条图标列（`--sb-slot`），上面所有行也用它——
            两处各写一个 18px 是巧合，共用一条槽是结构 */}
        <span className="foot__slot">
          {account === undefined ? (
            <GearIcon size={14} />
          ) : (
            <span className="avatar" aria-hidden="true">
              {initialOf(account.label)}
            </span>
          )}
        </span>
        <span className="foot__name">{account === undefined ? "设置" : nameOf(account)}</span>
      </button>
      <UpdateButton />
      {account === undefined ? null : (
        <Popover open={open} anchor={trigger.current} minWidth={210} onClose={close}>
          <div role="menu" aria-label="账号操作">
            {/* 身份再说一遍，连着额度——**「剩余 12%」单独摆出来是有歧义的**：
                一台机器上换过号的人，第一个问题是「谁的 12%」 */}
            <div className="pop__head">
              <div className="pop__head-title">{account.label}</div>
              {metaOf(account) === undefined ? null : (
                <div className="pop__head-meta">{metaOf(account)}</div>
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              className="pop__cmd"
              onClick={() => {
                close()
                onOpenSettings()
              }}
            >
              <span className="pop__cmd-icon">
                <GearIcon size={13} />
              </span>
              <span>设置</span>
              <span className="pop__cmd-hint">⌘,</span>
            </button>
            {/* 出问题时要交出去的那份东西。**和菜单栏里那一项是同一条路**，
                不是复制一份实现——摆两份实现的下场是其中一份迟早不更新 */}
            <button
              type="button"
              role="menuitem"
              className="pop__cmd"
              onClick={() => {
                close()
                window.switchback?.diagnose()
              }}
            >
              <span className="pop__cmd-icon">
                <FileIcon size={13} />
              </span>
              <span>导出诊断报告</span>
            </button>
          </div>
        </Popover>
      )}
    </div>
  )
}

/**
 * 这一行显示的那个名字。
 *
 * ## 邮箱只取 `@` 前面那一截
 *
 * 侧栏这一行宽 264px，减去头像那一列只剩两百出头。一个完整邮箱在这儿
 * **必然被截断，而且是从域名中间截**——实测显示成
 * `a1b2c3d4e5@privaterelay.appleid….`，那既不是名字也不是地址，只是一串乱码。
 * 域名从来不是这一行要回答的问题（「现在是谁」），砍掉它反而更准。
 *
 * **完整地址一个字都没丢**：`title` 上有，点开的菜单抬头里也有。
 * 这是显示形态的选择，不是替引擎改它报上来的东西。
 *
 * ## 有套餐就跟在后面
 *
 * 引擎报得上来的话，「谁」和「哪一档」是同一个问题的两半，而这一行
 * 此前只答了前一半——另一半藏在要点一下才出来的菜单里。
 */
export function nameOf(account: AccountLine): string {
  const at = account.label.lastIndexOf("@")
  const who = at > 0 ? account.label.slice(0, at) : account.label
  return account.plan === undefined || account.plan === "" ? who : `${who} · ${account.plan}`
}

/** 头像上那个字。取第一个字符——邮箱就是首字母，中文名就是姓。 */
function initialOf(label: string): string {
  return [...label][0]?.toUpperCase() ?? "?"
}

/** 菜单抬头第二行：套餐 · 还剩多少。两样都没有就不摆这一行。 */
function metaOf(account: AccountLine): string | undefined {
  const parts = [
    account.plan,
    account.remain === undefined ? undefined : `剩余 ${String(account.remain)}%`,
  ]
  const text = parts.filter((p) => p !== undefined && p !== "").join(" · ")
  return text === "" ? undefined : text
}

/** 悬停时不用点开也看得见额度——菜单是给要动手的时候用的。 */
function hoverOf(account: AccountLine): string {
  const meta = metaOf(account)
  return meta === undefined ? account.label : `${account.label}\n${meta}`
}
