/**
 * 固定视觉验收页面。
 *
 * `open` 把界面摆成那一屏，`ready` 证明它真的摆好了；少任意一个都可能
 * 把“点击没生效”拍成一张看似正常的重复截图。
 */
import { COMPOSE_VIEWS } from "./shot-views-compose.mjs"
import { EDITABLE_REVIEW_VIEW, REVIEW_VIEWS } from "./shot-views-review.mjs"
export const VIEWS = [
    { name: "01-转录区", open: null, ready: ".md" },
    {
      name: "02-桌宠固定地面",
      open: `(() => {
        const pet = document.querySelector('.pet--on') ?? document.querySelector('.pet')
        const brief = document.querySelector('.brief')
        if (pet === null || brief === null) {
          document.documentElement.dataset.petGround = 'false'
          return
        }
        const before = pet.getBoundingClientRect().bottom
        const probe = document.createElement('div')
        probe.style.cssText = 'height:72px;width:1px;flex:none'
        brief.append(probe)
        setTimeout(() => {
          const after = pet.getBoundingClientRect().bottom
          const composer = document.querySelector('.composer')?.getBoundingClientRect().top
          probe.remove()
          const petTop = Math.min(...[...document.querySelectorAll('.pet')]
            .map(node => node.getBoundingClientRect().top))
          const briefBottom = brief.getBoundingClientRect().bottom
          document.documentElement.dataset.petGround = String(
            composer !== undefined && Math.abs(after - before) < 2 && Math.abs(after - composer) < 10
              && briefBottom <= petTop,
          )
        }, 180)
      })()`,
      ready: `html[data-pet-ground]`,
      assert: `document.documentElement.dataset.petGround === 'true' && document.querySelector('.changed') === null`,
      after: `delete document.documentElement.dataset.petGround`,
    },
    {
      name: "03-环境信息",
      open: `document.querySelector('.topbar__title')?.click()`,
      ready: ".env",
      assert: `document.querySelector('.env')?.textContent.includes('AGENTS.md') === true`,
      after: `document.querySelector('.topbar__title')?.click()`,
    },
    ...REVIEW_VIEWS,
    {
      name: "05-拖入工作区文件",
      open: [
        `document.querySelector('.sidebar__new')?.click()`,
        `if (document.querySelector('.blank__title') === null) throw new Error('新会话没有就绪')`,
        `if (!document.activeElement?.classList.contains('composer__input')) throw new Error('新会话没有聚焦输入框'); document.querySelector('.sidebar__filter')?.focus()`,
      ],
      dragFiles: ["apps/desktop/src/renderer/attachment-feedback.ts"],
      // 故意落在空会话正文，不是输入框：整扇当前会话都该是文件落点。
      dragTarget: ".blank",
      ready: ".composer__attachwarn",
      assert: `document.querySelector('.composer__input')?.value
          .includes('@apps/desktop/src/renderer/attachment-feedback.ts') === true
        && document.querySelector('.composer__attachwarn')?.textContent.includes('已引用 1 个文件') === true
        && document.querySelector('.attach .thumb') === null
        && document.querySelector('.send')?.disabled === false
        && document.activeElement?.classList.contains('composer__input') === true`,
      after: `(() => {
        const input = document.querySelector('.composer__input')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(input, '')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
    },
    EDITABLE_REVIEW_VIEW,
    {
      name: "06-后台活动工作台",
      open: [
        `(() => {
          window.__omniMainWidth = document.querySelector('.main')?.getBoundingClientRect().width
          const resume = [...document.querySelectorAll('button')]
            .find(button => button.textContent.trim() === '继续这个会话')
          const resumeBox = resume?.getBoundingClientRect()
          window.__omniResumeInline = resume === undefined || (resumeBox !== undefined
            && resumeBox.width > resumeBox.height * 2 && resume.scrollWidth <= resume.clientWidth)
          const button = document.querySelector('[title="后台活动"]')
          button?.focus(); button?.click()
        })()`,
        `document.querySelector('.activity-row')?.click()`,
        `(() => {
          const command = document.querySelector('.lane-cmd-block code')
          const output = document.querySelector('.lane-output code')
          if (command === null || output === null) throw new Error('后台命令或输出没有就绪')
          command.textContent = 'pnpm --filter @omni/desktop test -- --runInBand --reporter verbose --coverage --changedSince origin/main --testNamePattern keyboard-scroll-workbench'
          output.textContent = Array.from({ length: 28 }, (_, index) =>
            String(index + 1).padStart(2, '0') + '  renderer activity output line ready',
          ).join('\\n')
        })()`,
      ],
      ready: ".activity-detail",
      assert: `(() => {
        const command = document.querySelector('.lane-cmd-block pre')
        const output = document.querySelector('.lane-output')
        if (command === null || output === null) return false
        const result = {
          commandOverflows: command.scrollWidth > command.clientWidth,
          commandFocusable: command.tabIndex === 0,
          commandLabelled: command.getAttribute('aria-label') === '可横向滚动的后台命令',
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
        const compact = innerWidth <= 1320
        result.threadLayout = compact
          ? getComputedStyle(main).display === 'none'
          : mainBox !== undefined && sidebarBox !== undefined && workbenchBox !== undefined
            && getComputedStyle(main).display === 'flex'
            && Math.abs(mainBox.left - sidebarBox.right) < 1
            && Math.abs(mainBox.right - workbenchBox.left) < 1
        result.workbenchLayout = workbenchBox !== undefined && sidebarBox !== undefined
          && (compact || mainBox !== undefined)
          && getComputedStyle(workbench).position === 'static'
          && Math.abs(workbenchBox.left - (compact ? sidebarBox.right : mainBox.right)) < 1
          && Math.abs(workbenchBox.right - innerWidth) < 1
        result.resumeStaysInline = window.__omniResumeInline === true
        if (Object.values(result).every(Boolean)) return true
        throw new Error('后台活动键盘滚动诊断：' + JSON.stringify(result))
      })()`,
      after: `delete window.__omniMainWidth; delete window.__omniResumeInline`,
    },
    {
      name: "06-工作台展开",
      open: `document.querySelector('.workbench__expand')?.click()`,
      ready: ".shell--workbench-full .workbench:not([hidden])",
      assert: `getComputedStyle(document.querySelector('.main')).display === 'none'
        && document.querySelector('.workbench__expand')?.getAttribute('aria-label') === '并排显示工作台'
        && (() => {
          const workbench = document.querySelector('.workbench')?.getBoundingClientRect()
          const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
          return workbench !== undefined && sidebar !== undefined
            && Math.abs(workbench.left - sidebar.right) < 1 && Math.abs(workbench.right - innerWidth) < 1
        })()`,
      after: `document.querySelector('.workbench__expand')?.click()`,
    },
    {
      name: "07-文件清单",
      open: `document.querySelector('[title="文件预览"]')?.click()`,
      ready: ".file-row",
      assert: `document.activeElement?.matches('.files-search input') === true
        && document.querySelector('.workbench')?.getAttribute('aria-modal') === null
        && document.querySelector('.workbench__scrim') === null
        && getComputedStyle(document.querySelector('.main')).display === (innerWidth <= 1320 ? 'none' : 'flex')
        && !document.querySelector('.files-index')?.textContent.includes('failed-secret.txt')
        && document.querySelector('.files-scope')?.textContent.includes('搜索当前工作区') === true
        && document.querySelector('.files-scope')?.textContent.includes('文件变化会自动更新') === true
        && document.querySelector('.files-index')?.textContent.includes('最近一轮改过') === true
        && document.querySelector('.files-index')?.textContent.includes('此前碰过') === true
        && document.querySelector('.files-index')?.textContent.includes('AGENTS.md') === true`,
    },
    {
      name: "08-缺失文件可恢复",
      open: `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('missing-output.txt'))?.click()`,
      ready: ".file-preview .workbench__empty",
      assert: `(() => {
        const preview = document.querySelector('.file-preview')
        return preview?.textContent.includes('文件已经不存在') === true
          && preview.querySelector('[aria-label="重新读取文件"]') !== null
          && preview.querySelector('[aria-label="引用到输入框"]') === null
          && preview.querySelector('[aria-label="在访达中显示"]') === null
      })()`,
    },
    {
      name: "09-文件搜索",
      open: [
        `document.querySelector('.workbench__page:not([hidden]) .workbench__back')?.click()`,
        `(() => {
        const input = document.querySelector('.files-search input')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        input?.focus()
        setter?.call(input, 'attachment')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
        setTimeout(() => input?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        ), 0)
        })()`,
      ],
      ready: ".file-row",
      assert: `document.activeElement?.classList.contains('file-row') === true
        && document.activeElement.textContent.toLowerCase().includes('attachment')`,
    },
    {
      name: "09-搜索返回保留",
      open: [
        `(() => { window.__omniFileIndex = document.querySelector('.files-index'); document.activeElement?.click() })()`,
        `document.querySelector('.workbench__page:not([hidden]) .workbench__back')?.click()`,
      ],
      ready: ".files-search input",
      assert: `document.querySelector('.files-search input')?.value === 'attachment'
        && document.querySelector('.files-index')?.textContent.includes('attachments.ts') === true
        && document.querySelector('.files-index')?.textContent.includes('正在搜索') === false
        && document.querySelector('.files-index') === window.__omniFileIndex
        && document.activeElement?.matches('.files-search input') === true`,
    },
    {
      name: "09-搜索持续刷新",
      createFiles: ["apps/desktop/src/renderer/attachment-live-refresh-probe.ts"],
      open: `(() => {
        window.__omniRefreshProbe = setInterval(() => {
          const found = [...document.querySelectorAll('.file-row')]
            .find(row => row.textContent.includes('attachment-live-refresh-probe.ts'))
          if (found === undefined) return
          found.scrollIntoView({ block: 'nearest' })
          clearInterval(window.__omniRefreshProbe)
          document.documentElement.dataset.fileRefresh = 'ready'
        }, 50)
        window.dispatchEvent(new Event('focus'))
      })()`,
      ready: "html[data-file-refresh=ready]",
      assert: `document.querySelector('.files-search input')?.value === 'attachment'
        && document.querySelector('.files-index') === window.__omniFileIndex
        && document.querySelector('.files-index')?.textContent.includes('attachment-live-refresh-probe.ts') === true
        && document.activeElement?.matches('.files-search input') === true`,
      after: `(() => {
        clearInterval(window.__omniRefreshProbe); delete window.__omniRefreshProbe
        delete document.documentElement.dataset.fileRefresh
      })()`,
    },
    {
      name: "09-切页重开保留",
      open: [
        `window.__omniWorkbench = document.querySelector('.workbench'); [...document.querySelectorAll('.workbench__tab')].find(tab => tab.textContent.includes('活动'))?.click()`,
        `[...document.querySelectorAll('.workbench__tab')].find(tab => tab.textContent.includes('文件'))?.click()`,
        `document.querySelector('.workbench__hide')?.click()`,
        `document.querySelector('[title="文件预览"]')?.click()`,
      ],
      ready: ".files-search input",
      assert: `document.querySelector('.files-search input')?.value === 'attachment'
        && document.querySelector('.files-index')?.textContent.includes('attachments.ts') === true
        && document.querySelector('.files-index') === window.__omniFileIndex
        && document.querySelector('.workbench') === window.__omniWorkbench
        && document.activeElement?.matches('.files-search input') === true`,
      after: `(() => {
        delete window.__omniFileIndex
        delete window.__omniWorkbench
        document.querySelector('.files-search input')?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        )
      })()`,
    },
    {
      name: "10-工作区外文件预览",
      open: `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('会话碰过的工作区外文件.md'))?.click()`,
      ready: ".file-source",
      assert: `document.querySelector('[aria-label="继续会话后引用到输入框"]')?.disabled === true
        && document.querySelector('[aria-label="继续会话后引用到输入框"]')?.textContent.includes('继续后引用') === true`,
    },
    {
      name: "11-HTML预览",
      open: [
        `document.querySelector('.workbench__page:not([hidden]) .workbench__back')?.click()`,
        `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('旁路侧栏-原型.html'))?.click()`,
        `(() => {
          const preview = document.querySelector('[role="tab"][aria-selected="true"]')
          preview?.focus()
          preview?.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', bubbles: true, cancelable: true,
          }))
          setTimeout(() => {
            const source = [...document.querySelectorAll('[role="tab"]')]
              .find(tab => tab.textContent.trim() === '源码')
            const forward = source?.getAttribute('aria-selected') === 'true'
              && document.activeElement === source && document.querySelector('.file-source') !== null
            source?.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'ArrowLeft', bubbles: true, cancelable: true,
            }))
            setTimeout(() => {
              const active = document.querySelector('[role="tab"][aria-selected="true"]')
              const panel = document.querySelector('[role="tabpanel"]')
              document.documentElement.dataset.htmlTabs = String(forward
                && active?.textContent.trim() === '预览' && document.activeElement === active
                && [...document.querySelectorAll('[role="tab"]')]
                  .filter(tab => tab.getAttribute('tabindex') === '0').length === 1
                && panel?.getAttribute('aria-labelledby') === active?.id)
            }, 30)
          }, 30)
        })()`,
      ],
      ready: `html[data-html-tabs="true"]`,
      assert: `document.querySelector('.html-preview__frame') !== null`,
      after: `delete document.documentElement.dataset.htmlTabs`,
    },
    ...COMPOSE_VIEWS,
]
