/** 后台活动工具组的详情、布局与返回焦点场景。 */
export const ACTIVITY_VIEWS = [
  {
    name: "06-后台活动工作台",
    open: [
      `(() => {
        window.__switchbackMainWidth = document.querySelector('.main')?.getBoundingClientRect().width
        const button = document.querySelector('[title="后台活动"]')
        button?.focus(); button?.click()
      })()`,
      `(() => {
        const row = document.querySelector('.activity-row')
        window.__switchbackActivityRow = row
        row?.focus(); row?.click()
      })()`,
      `(() => {
        const command = document.querySelector('.lane-cmd-block code')
        const output = document.querySelector('.lane-output code')
        if (command === null || output === null) throw new Error('后台命令或输出没有就绪')
        command.textContent = 'pnpm --filter @switchback/desktop test -- --runInBand --reporter verbose --coverage --changedSince origin/main --testNamePattern keyboard-scroll-workbench'
        output.textContent = Array.from({ length: 28 }, (_, index) =>
          String(index + 1).padStart(2, '0') + '  renderer activity output line ready',
        ).join('\\n')
      })()`,
    ],
    ready: ".activity-detail",
    assert: `(() => {
      const command = document.querySelector('.lane-cmd-block pre')
      const commandToolbar = document.querySelector('.lane-cmd-block__toolbar')
      const output = document.querySelector('.lane-output')
      if (command === null || commandToolbar === null || output === null) return false
      const commandBox = command.getBoundingClientRect()
      const toolbarBox = commandToolbar.getBoundingClientRect()
      const result = {
        commandOverflows: command.scrollWidth > command.clientWidth,
        commandFocusable: command.tabIndex === 0,
        commandLabelled: command.getAttribute('aria-label') === '可横向滚动的后台命令',
        commandSeparated: commandBox.top >= toolbarBox.bottom,
        outputOverflows: output.scrollHeight > output.clientHeight,
        outputFocusable: output.tabIndex === 0,
        outputLabelled: output.getAttribute('aria-label') === '可滚动的后台输出',
      }
      command.focus()
      result.commandFocused = document.activeElement === command
      result.copyVisible = Number(getComputedStyle(document.querySelector('.lane-cmd-block__copy')).opacity) > 0
      const main = document.querySelector('.main')
      const workbench = document.querySelector('.workbench')
      const sidebar = document.querySelector('.sidebar')
      const workbenchBox = workbench?.getBoundingClientRect()
      const sidebarBox = sidebar?.getBoundingClientRect()
      const mainBox = main?.getBoundingClientRect()
      // **不分宽窄，永远是三块紧挨着排**：导航右缘 = 会话左缘，会话右缘 = 工具台左缘。
      // 上一版在 ≤1280 时另有一套（导航 display:none、会话贴到 x=0）——
      // 那条已经去掉了：点开右边的面板不该让左边消失，窄了让工具台收窄就行。
      result.threadLayout = mainBox !== undefined && sidebarBox !== undefined
        && workbenchBox !== undefined
        && getComputedStyle(main).display === 'flex'
        && sidebarBox.width > 100
        && Math.abs(mainBox.left - sidebarBox.right) < 1
        && Math.abs(mainBox.right - workbenchBox.left) < 1
      result.workbenchLayout = workbenchBox !== undefined && sidebarBox !== undefined
        && mainBox !== undefined
        && getComputedStyle(workbench).position === 'static'
        && Math.abs(workbenchBox.left - mainBox.right) < 1
        && Math.abs(workbenchBox.right - innerWidth) < 1
      if (Object.values(result).every(Boolean)) return true
      throw new Error('后台活动键盘滚动诊断：' + JSON.stringify(result))
    })()`,
    after: `delete window.__switchbackMainWidth`,
  },
  {
    name: "06-后台命令复制有确认",
    open: `(() => {
      const button = document.querySelector('.lane-cmd-block__copy')
      button?.focus(); button?.click()
    })()`,
    ready: ".lane-cmd-block__copy",
    assert: `document.querySelector('.lane-cmd-block__copy')?.getAttribute('data-state') === 'copied'
      && document.querySelector('.lane-cmd-block__copy')?.textContent.includes('已复制') === true
      && document.querySelector('.lane-cmd-block__copy')?.getAttribute('data-tip') === '内容已复制'
      && document.activeElement?.classList.contains('lane-cmd-block__copy') === true`,
  },
  {
    name: "06-工作台展开",
    open: `document.querySelector('.workbench .panel-tabs__expand')?.click()`,
    ready: ".shell--workbench-full .workbench:not([hidden])",
    assert: `getComputedStyle(document.querySelector('.main')).display === 'none'
      && document.querySelector('.workbench .panel-tabs__expand')?.getAttribute('aria-label') === '并排显示侧边面板'
      && (() => {
        const workbench = document.querySelector('.workbench')?.getBoundingClientRect()
        const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
        return workbench !== undefined && sidebar !== undefined
          && Math.abs(workbench.left - sidebar.right) < 1 && Math.abs(workbench.right - innerWidth) < 1
      })()`,
    after: `document.querySelector('.workbench .panel-tabs__expand')?.click()`,
  },
  {
    name: "06-活动返回原行",
    open: `document.querySelector('.activity-detail > .workbench__back')?.click()`,
    ready: ".activity-list:not([hidden]) .activity-row",
    assert: `document.activeElement === window.__switchbackActivityRow
      && window.__switchbackActivityRow?.isConnected === true
      && document.activeElement?.getAttribute('aria-keyshortcuts') === 'ArrowUp ArrowDown Home End'`,
    after: `delete window.__switchbackActivityRow`,
  },
]
