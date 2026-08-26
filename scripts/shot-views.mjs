/**
 * 固定视觉验收页面。
 *
 * `open` 把界面摆成那一屏，`ready` 证明它真的摆好了；少任意一个都可能
 * 把“点击没生效”拍成一张看似正常的重复截图。
 */
import { COMPOSE_VIEWS } from "./shot-views-compose.mjs"

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
    {
      name: "04-Git审核",
      open: [], shortcut: { key: "r", code: "KeyR", modifiers: 12, windowsVirtualKeyCode: 82 },
      ready: ".rv",
      assert: `(document.querySelector('.rv__file') !== null
          || document.querySelector('.rv')?.textContent.includes('当前工作区相对 HEAD 是干净的') === true)
        && !document.querySelector('.rv__pane')?.textContent.includes('读取当前净补丁失败')
        && (() => { const diff = document.querySelector('.rvd'); return diff === null
          || (diff.focus(), document.activeElement === diff) })()
        && (window.innerWidth > 1000 || (() => {
          const title = document.querySelector('.rv__title')?.getBoundingClientRect()
          const tools = document.querySelector('.rv__tools')?.getBoundingClientRect()
          const buttons = [...document.querySelectorAll('.rv__seg')].map(button => button.getBoundingClientRect())
          return title !== undefined && tools !== undefined && tools.top >= title.bottom
            && buttons.every(button => button.height < 40 && button.width > 24)
        })())`,
      after: `document.querySelector('.rv__close')?.click()`,
    },
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
        ;[...document.querySelectorAll('.row--thread .row__main')]
          .find(row => row.textContent.includes('useFlow'))?.click()
      })()`,
    },
    {
      name: "06-后台活动工作台",
      open: [
        `(() => { const button = document.querySelector('[title="后台活动"]'); button?.focus(); button?.click() })()`,
        `document.querySelector('.activity-row')?.click()`,
      ],
      ready: ".activity-detail",
    },
    {
      name: "07-文件清单",
      open: `document.querySelector('[title="文件预览"]')?.click()`,
      ready: ".file-row",
      assert: `document.activeElement?.matches('.files-search input') === true && document.querySelector('.workbench')?.getAttribute('aria-modal') === (window.innerWidth <= 1120 ? 'true' : null) && (window.innerWidth > 1120 || (() => { const box = document.querySelector('.workbench'); const before = document.activeElement; const nodes = [...box.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')]; nodes.at(-1)?.focus(); document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); const trapped = document.activeElement === nodes[0]; before?.focus(); return trapped })()) && getComputedStyle(document.querySelector('.workbench__scrim')).display === (window.innerWidth <= 1120 ? 'block' : 'none')
        && !document.querySelector('.files-index')?.textContent.includes('failed-secret.txt')
        && document.querySelector('.files-scope')?.textContent.includes('搜索范围是当前工作区') === true
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
