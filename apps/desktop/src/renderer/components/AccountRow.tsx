/**
 * 侧栏最底下那一行：**登录的是谁，还剩多少额度**。
 *
 * ## 为什么这两件事要放在一起
 *
 * 「剩余 12%」单独摆出来是有歧义的——一台机器上换过号的人，
 * 第一个问题是「谁的 12%」。额度是账号级的，那就跟账号画在一起。
 *
 * ## 为什么是常驻，而顶栏那枚额度 pill 只在快满时出现
 *
 * 两者说的不是一件事。顶栏那枚是**警报**：平时它是纯噪声，一直亮着人就不看了，
 * 所以只在接近上限时出声（见 `limits.ts`）。这一行是**身份**：
 * 你随时可能想确认「现在用的是哪个号」，而它不闪不跳，不构成打扰。
 */

export interface AccountLine {
  /** 邮箱或用户名。 */
  label: string
  /** 套餐，比如 `prolite`。报不上来就缺席。 */
  plan?: string
  /** 还剩百分之几。报不上来就缺席——**不显示成 100%**，那是撒谎。 */
  remain?: number
}

export function AccountRow({ account }: { account: AccountLine }): React.JSX.Element {
  return (
    <div className="row row--foot row--account" title={titleOf(account)}>
      <span className="row__slot">
        <span className="avatar" aria-hidden="true">
          {initialOf(account.label)}
        </span>
      </span>
      <span className="row__label">{account.label}</span>
      {account.remain === undefined ? null : (
        <span className={`row__aside${account.remain <= 10 ? " row__aside--warn" : ""}`}>
          剩余 {String(account.remain)}%
        </span>
      )}
    </div>
  )
}

/** 头像上那个字。取第一个字符——邮箱就是首字母，中文名就是姓。 */
function initialOf(label: string): string {
  return [...label][0]?.toUpperCase() ?? "?"
}

/**
 * 悬停时说全一点。**套餐名摆在这儿而不是行上**：
 * 那一行已经有邮箱和百分比，再塞一个 `prolite` 就要开始截断了，
 * 而被截掉的往往是邮箱——那是这一行最该说清楚的东西。
 */
function titleOf(account: AccountLine): string {
  const parts = [account.label]
  if (account.plan !== undefined) parts.push(`套餐：${account.plan}`)
  if (account.remain !== undefined) parts.push(`额度还剩 ${String(account.remain)}%`)
  return parts.join("\n")
}
