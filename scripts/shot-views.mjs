/**
 * 固定视觉验收页面。
 *
 * `open` 把界面摆成那一屏，`ready` 证明它真的摆好了；少任意一个都可能
 * 把“点击没生效”拍成一张看似正常的重复截图。
 */
import { COMPOSE_VIEWS } from "./shot-views-compose.mjs"
import { ACTIVITY_VIEWS } from "./shot-views-activity.mjs"
import { FILE_REFRESH_VIEWS } from "./shot-views-file-refresh.mjs"
import { EDITABLE_REVIEW_VIEW, REVIEW_VIEWS } from "./shot-views-review.mjs"
import { openPanelPage } from "./shot-panel.mjs"
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
    ...ACTIVITY_VIEWS,
    {
      name: "07-文件清单",
      open: openPanelPage("文件"),
      ready: ".file-row",
      assert: `(() => {
        const scope = document.querySelector('.files-scope__root bdi')
        const index = document.querySelector('.files-index')
        const checks = {
          focus: document.activeElement?.matches('.files-search input') === true,
          nonModal: document.querySelector('.workbench')?.getAttribute('aria-modal') === null
            && document.querySelector('.workbench__scrim') === null,
          responsive: getComputedStyle(document.querySelector('.main')).display === 'flex'
            && (innerWidth > 1280
              || getComputedStyle(document.querySelector('.sidebar')).display === 'none'),
          clean: !index?.textContent.includes('failed-secret.txt'),
          scope: scope?.textContent.endsWith('/omni') === true
            && scope?.getAttribute('title')?.endsWith('/omni') === true,
          copy: document.querySelector('.files-scope')?.textContent.includes('文件变化会自动更新') === true,
          groups: index?.textContent.includes('最近一轮改过') === true
            && index?.textContent.includes('此前碰过') === true
            && index?.textContent.includes('AGENTS.md') === true,
          tabStop: [...document.querySelectorAll('.file-row')].filter(row => row.tabIndex === 0).length === 1
            && document.querySelector('.file-row[tabindex="0"]')?.disabled === false,
        }
        if (Object.values(checks).every(Boolean)) return true
        throw new Error('文件清单验收：' + JSON.stringify(checks))
      })()`,
    },
    {
      name: "07-新建侧边页面",
      open: `document.querySelector('.workbench:not([hidden]) [aria-label="新建侧边页面"]')?.click()`,
      ready: `[role="menu"][aria-label="新建侧边页面"]`,
      assert: `(() => {
        const menu = document.querySelector('[role="menu"][aria-label="新建侧边页面"]')
        return ['审查', '文件', '活动'].every(label => menu?.textContent.includes(label) === true)
          && document.activeElement?.getAttribute('role') === 'menuitem'
      })()`,
      after: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
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
        && document.activeElement.textContent.toLowerCase().includes('attachment')
        && document.activeElement.tabIndex === 0
        && [...document.querySelectorAll('.file-row')]
          .filter(row => row.tabIndex === 0).length === 1`,
    },
    {
      name: "09-搜索返回保留",
      open: [
        `(() => { window.__omniFileIndex = document.querySelector('.files-index'); window.__omniFileRow = document.activeElement; document.activeElement?.click() })()`,
        `document.querySelector('.workbench__page:not([hidden]) .workbench__back')?.click()`,
      ],
      ready: ".files-search input",
      assert: `(() => {
        const index = document.querySelector('.files-index')
        const result = {
          query: document.querySelector('.files-search input')?.value,
          hasResult: index?.textContent.includes('attachments.ts') === true,
          settled: index?.textContent.includes('正在搜索') === false,
          sameIndex: index === window.__omniFileIndex,
          sameRow: document.activeElement === window.__omniFileRow,
          oneTabStop: [...(index?.querySelectorAll('.file-row') ?? [])]
            .filter(row => row.tabIndex === 0).length === 1,
          activeTabStop: document.activeElement?.tabIndex,
          activeClass: document.activeElement?.className,
          expectedPath: window.__omniFileRow?.dataset?.filePath,
          activePath: document.activeElement?.dataset?.filePath,
          paths: [...(index?.querySelectorAll('.file-row') ?? [])].map(row => row.dataset.filePath),
        }
        if (result.query === 'attachment' && result.hasResult && result.settled
          && result.sameIndex && result.sameRow && result.oneTabStop
          && result.activeTabStop === 0 && result.activeClass.includes('file-row')) return true
        throw new Error('文件详情返回焦点诊断：' + JSON.stringify(result))
      })()`,
    },
    ...FILE_REFRESH_VIEWS,
    {
      name: "09-切页重开保留",
      open: [
        `window.__omniWorkbench = document.querySelector('.workbench')`,
        ...openPanelPage("活动"),
        ...openPanelPage("文件"),
        `document.querySelector('.workbench .panel-tabs__button[aria-label="隐藏侧边面板"]')?.click()`,
        ...openPanelPage("文件"),
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
        && document.querySelector('[aria-label="继续会话后引用到输入框"]')?.textContent.includes('继续后引用') === true
        && document.querySelector('.file-preview__scope')?.textContent === '工作区外'
        && document.querySelector('.file-preview__path')?.textContent.includes('工作区外') === true`,
    },
    {
      name: "11-HTML预览",
      open: [
        `document.querySelector('.workbench__page:not([hidden]) .workbench__back')?.click()`,
        `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('旁路侧栏-原型.html'))?.click()`,
        `(() => {
          const preview = document.querySelector('.file-preview [role="tab"][aria-selected="true"]')
          preview?.focus()
          preview?.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', bubbles: true, cancelable: true,
          }))
          setTimeout(() => {
            const source = [...document.querySelectorAll('.file-preview [role="tab"]')]
              .find(tab => tab.textContent.trim() === '源码')
            const forward = source?.getAttribute('aria-selected') === 'true'
              && document.activeElement === source && document.querySelector('.file-source') !== null
            source?.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'ArrowLeft', bubbles: true, cancelable: true,
            }))
            setTimeout(() => {
              const active = document.querySelector('.file-preview [role="tab"][aria-selected="true"]')
              const panel = document.querySelector('.file-preview [role="tabpanel"]')
              document.documentElement.dataset.htmlTabs = String(forward
                && active?.textContent.trim() === '预览' && document.activeElement === active
                && [...document.querySelectorAll('.file-preview [role="tab"]')]
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
