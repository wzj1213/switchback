/** 品牌跟随导航的两条对齐轴，不随窗口宽度向交通灯旁边漂移。 */
export const BRAND_VIEWS = [
  {
    name: "61-品牌与导航对齐",
    open: `true`,
    ready: ".sidebar__wordmark",
    assert: `(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect()
      const brand = box('.sidebar__brand'), mark = box('.sidebar__brand .omni-mark')
      const words = ['.sidebar__wordmark', '.sidebar__new-label', '.row--group .row__label']
        .map(selector => box(selector).left)
      const icon = box('.row--group .row__slot')
      const title = box('.topbar'), panel = document.querySelector('.workbench:not([hidden]) .panel-tabs')?.getBoundingClientRect()
      return Math.max(...words) - Math.min(...words) < 1 && brand.top >= 40 &&
        mark.width === 20 && mark.height === 20 &&
        Math.abs(mark.left + mark.width / 2 - icon.left - icon.width / 2) < 1 &&
        mark.right < words[0] && box('.sidebar__new').height === 32 &&
        brand.right <= box('.sidebar').right && (panel === undefined || panel.height === title.height)
    })()`,
  },
]
