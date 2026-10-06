/** 点选预览必须改变真实主题、保留选择状态，并通过两套颜色的可访问性检查。 */
export async function checkThemeCards({ value, waitFor, pause, audit, assert }, cdp) {
  await cdp.send("Emulation.setEmulatedMedia", { media: "", features: [] })
  for (const theme of ["dark", "light"]) {
    await value(cdp, `document.querySelector('.theme-card--${theme}')?.click(); true`)
    await waitFor(cdp, `document.querySelector('.theme-card--${theme}')?.getAttribute('aria-pressed') === 'true'`)
    await pause(250)
    const actual = await value(cdp, `window.switchback.settings().then(settings => settings.theme)`)
    assert(actual === theme, `主题预览已保存 ${theme} 选择`)
    const surface = theme === "dark" ? "rgb(32, 34, 37)" : "rgb(255, 255, 255)"
    await waitFor(cdp, `getComputedStyle(document.querySelector('.set')).backgroundColor === '${surface}'`)
    assert(true, `主题预览已切换 ${theme} 画布`)
    await audit(cdp, `${theme} 设置面板`)
  }
}
