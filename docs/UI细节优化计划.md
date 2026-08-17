# omni · UI 细节优化计划 · 2026-08-17

> 面向 dev。**这份计划已经落地**（2026-08-17 当天，36 条全做，只有第 35 条按它自己的
> 结论没做——那是基调选择不是缺陷）。留在这里是因为每一条都记着**为什么**：
> 下次有人想把某个值改回去时，理由在这儿。
>
> 落地时的两条偏差记在这里，正文没改：
> - **第 32 条（发送键改近黑）**原文写着「该由作者拍板」——作者拍了，做了。
> - **专节的滚动条**按结论没有自绘，产出是 app.css 顶上那段注释 + `.transcript` 的 `scrollbar-gutter`。
>
> 怎么得出来的：六个维度并行勘察（滚动条与滚动行为 / 字体与排版 / 颜色层次与分隔 /
> 间距节奏与对齐 / 动效状态与可达性 / 组件细节与完成度），每条提案再由另一个人
> **对着代码逐条核对**——现状描述对不对、是不是已经做过、Chromium 里成不成立、
> 有没有推翻本仓库注释里已写明的决定。留下 44 条，合成这份。
>
> 所有 file:line 与数值都是核对时实读的；真机才验得了的地方，文中标了「必须真机验」。

现在这套界面欠的不是设计，是**把已经写明的决定执行到位**。9 个从未定义过的 token 让 15 条声明静默作废——发送键的箭头是黑的、停止键没有底色、缩略图是直角；选中的会话行一悬停反而变淡；顶栏标题按钮压在拖拽区里点不开。这些不是审美分歧，是写了没跑起来。先清掉这批，再谈节奏、动效和字号。

---

## 第一批 · 立刻做

改动小、收益明显、几乎没有回归风险。除标注外都不需要出图。

### 1. 15 条声明引用了 9 个不存在的 token，整条作废

- **现状**：`comm -23`（全仓 `var(--x)` 减去全部 css 文件里的定义）剩下正好 9 个名字：`--accent-ink`、`--accent-hover`、`--surface-1/2/3/4`、`--radius-md`、`--text-dim`、`--mono`。实测计算值：`.send` 的 `color = rgb(22,22,26)`（继承来的深色，压在 `#3b6fd4` 上 3.79:1；深色 2.14:1）、`.send--stop` 和 `.send:disabled` 的 `background = rgba(0,0,0,0)`、`.thumb__hit` 的 `border-radius = 0px`、`pre.error__raw` 的 `font-family = -apple-system`。
- **改成**（逐条映射到已有 token，不新增任何 token）：
  - app.css:1164 `--accent-ink` → `var(--text-inverse)`（浅 4.76:1 / 深 7.10:1）
  - app.css:1170 `.send:hover:not(:disabled)` 整条改 `opacity: .88`，删掉 `background`（对齐 items.css:280-283 `.btn--primary:hover`；这样第 32 条改不改底色都不用再动它）
  - app.css:1174 `.send:disabled` → `var(--bg-hover)`
  - app.css:1181 `.send--stop` → `var(--bg-hover)`；app.css:1186 hover → `var(--bg-active)`
  - app.css:1365 `.limit` → `var(--bg-active)`
  - app.css:1402 `.thumb__hit` `--radius-md` → `var(--radius-sm)`；1403 → `var(--bg-sunken)`
  - app.css:1443 `.thumb__drop` → `2px solid var(--bg-raised)`
  - app.css:1472 / 1520 `--radius-md` → `var(--radius)`；1521 → `var(--bg-sunken)`
  - items.css:448 `--text-dim` → `var(--text-muted)`
  - items.css:659、settings.css:145 `--mono` → `var(--font-mono)`
  - 新增 `scripts/check-tokens.mjs` 串进 `pnpm check`（照 `check-arch.mjs` 的写法）：定义集**必须扫全部 css 文件**（`--sb-pad/--sb-slot/--sb-row-h/--sb-act` 定义在 app.css:66-78 的 `.sidebar` 里），且跳过 `var(--x, fallback)` 两参形式（app.css:1609 是合法写法）。
- **为什么**：`.thumb__drop` 那条是 `border` **简写**，含无效 `var()` 会让整条简写作废，`border-style` 退回 `none`——app.css:1441「一圈底色的描边：贴着别的缩略图时也分得开」画的那圈**根本不存在**。`font-family` 是继承属性，作废后 `<pre>` 连 UA 的 monospace 都拿不到，于是 settings.css:144「更新失败时 npm 的原文。**要能看见**」是用界面无衬线字体渲染的。
- **动哪儿**：app.css、items.css、settings.css、新增 scripts/check-tokens.mjs、package.json。
- **风险**：这些控件会第一次真的出现底色和圆角，看着「多了东西」，那是它们本来的样子。`.send--stop` 取 rest=`--bg-hover` / hover=`--bg-active`，依据是 app.css:434/440 的 `.foot__act` 同一套（app.css:419-424「**平时就带底色**……比过三版」）；另一种意见主张 rest 就用 `--bg-active`，出图时一并看。`.thumb__drop` 补回 2px 边框后内容盒缩到 14px，确认那个 12px 的 ✕ 没被裁。

### 2. 选中的会话行一悬停反而变淡；`/` 面板的键盘光标和鼠标 hover 撞色

- **现状**：app.css:150 `.row:hover { background: var(--bg-hover) }` 是 (0,2,0)，app.css:234 `.row--selected { background: var(--bg-active) }` 是 (0,1,0)，全仓无 `.row--selected:hover`。浅色 #e8e8ec → #f0f0f2（ΔL\*=+2.78 变亮），深色 #2c2c33 → #232328（ΔL\*=−4.39 变暗）。app.css:1233-1235 里 `.slash__row--active`（键盘光标）和 `.slash__row:hover` 是**同一条声明**。
- **改成**：app.css:234 选择器提到 `.row.row--selected`（240 行的 `.row--selected .row__slot` 一并提），并紧跟一条 `.row.row--selected:hover { background: var(--bg-active); }`。app.css:1233 拆成两条：`.slash__row:hover { background: var(--bg-hover) }`、其后 `.slash__row--active { background: var(--bg-active) }`。
- **为什么**：指针放到「当前打开的这条」上，选中态被 hover 压掉一档——两套主题都往「更不显眼」走。同一个坑 app.css:251 的 `.row--search:hover` 已经打过一次补丁，只是没回头修选中行。slash 那处是深色下键盘高亮相对面板底只有 ΔL\*=2.91，拆开后是 7.30，而且 `@` 列表（app.css:997）本来就是这么写的。
- **动哪儿**：app.css。
- **风险**：几乎为零。第 19 条落地带来 `--bg-press` 之后，把 `.row.row--selected:hover` 升成 `--bg-press`（同一行，一次改完），选中行 hover 才是「再深一档」而不是「钉住不动」。`.mentions__row` 不要顺手动——它根本没有 `:hover` 规则，缺的是另一件事。

### 3. 顶栏标题按钮落在拖拽区里点不开；长标题被硬裁，连箭头一起裁没

- **现状**：全仓 `-webkit-app-region` 只有 5 处，`.topbar`（app.css:635）是 drag，而 `.topbar__title`（640-658）、`.meter`（744）、`.limit`（1361）、`.pop`（popover.css:61）**都没有 no-drag**——`.badge`(677) / `.iconbtn`(693) / `.tbtn`(1020) 都有。同时 app.css:655 的 `text-overflow: ellipsis` 挂在一个 `display: flex` 的容器上，从来没执行过；TopBar.tsx:120 的裸文本变匿名 flex 项，`min-width: auto` 下不缩，被 656 行的 `overflow: hidden` 齐着字形硬切，排在它后面的 `CaretIcon` 整个落在裁切区外。app.css:654 是全仓唯一的 `font-weight: 550`。
- **改成**：四处各补一行 `-webkit-app-region: no-drag;`（`.topbar__title` / `.meter` / `.limit` / `.pop`）。TopBar.tsx:120 的裸文本包成 `<span className="topbar__title-text">`，新增 `.topbar__title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`，删掉 app.css:655。app.css:654 `550` → `600`。
- **为什么**：Electron 里拖拽区内的元素收不到点击——EnvCard 除了点标题没有别的入口，所以「`/timeline` 能开、环境卡片开不出来」正是这个 bug 的可证伪点。`min-width: 0` 和 `text-overflow` 都必须写在子元素上（后者不是继承属性），否则照旧不缩。
- **动哪儿**：app.css、popover.css、TopBar.tsx。
- **风险**：**`white-space: nowrap`（app.css:656）留在 `.topbar__title` 上不要删**——Compare.tsx:148 把同一个类当 `<span>` 复用且没有子 span，删掉会在 52px 顶栏里折行被切；留着还顺便继承给新 span。550 → 600 的理由缩到 mac 一条：PingFang SC 没有 550 面（按 CSS Fonts L4 落到 600），而 `-apple-system` 拉丁部分能真渲染 550，中英混排标题里一行两个字重。**必须真机验**：`hiddenInset` 下窗口顶部原生 titlebar 那约 28px 带会不会仍吃掉点击（按钮实际占 y≈13.5~38.5）；顺手确认拖顶栏空白处仍能移窗。

### 4. 引擎时间线卡片被 `.seg` 撞名压坏；`.card` / `.card__head` 一行样式都没有

- **现状**：main.tsx 的加载顺序里 settings.css 在最后，它的 `.seg`（settings.css:106-112，三段开关）与 app.css:1617+ 的时间线 `.seg` 同权重 (0,1,0)，后来者全赢。实测 TimelineCard 的 `.seg` 拿到 `display: inline-flex` + `padding: 2px` + `--bg-sunken` 底色，420px 宽的卡片里 uuid 句柄被挤成**每行一个字符的竖条**。`.card` / `.card__head` 全仓无规则（只有 app.css:1683 的 `.card__empty`），卡片内容距浮层边框 5px，对照 `.env` 是 17px。
- **改成**：settings.css:106-134 三个类改名 `.seg` → `.switch`、`.seg__item` → `.switch__item`、`.seg__item--on` → `.switch__item--on`，SettingsPanel.tsx:64 / :71 两处字符串跟着改（外观零变化）。popover.css:232-241 的两条规则各加一个选择器：`.env, .card { padding: var(--sp-3); font-size: var(--text-sm) }`、`.env__title, .card__head { margin-bottom: var(--sp-2); color: var(--text-faint); font-size: var(--text-xs) }`。
- **为什么**：这不是「不够精致」，是这张卡片**现在完全读不了**。抬头合并选择器而不是复制一份：两张卡是同一颗按钮二选一弹出的（TopBar.tsx:50-66），写成两份将来必然分岔。
- **动哪儿**：settings.css、popover.css、SettingsPanel.tsx、app.css（1613 那段开头加一行注释指向 popover.css:232，免得下次找不到）。
- **风险**：`grep className` 只有 TimelineCard.tsx（8 处）和 SettingsPanel.tsx（2 处）命中，改名是机械替换。实测浮层高度 372 → **260.66**（句柄不再一个字符一行，是变矮不是变高），`.pop` 的 `max-height: min(60vh, 420px)` 连滚都不用。

### 5. 设置面板的遮罩自己在滚，滚动条画在窗口最右边缘

- **现状**：settings.css:9-19 `.set__scrim { position: fixed; inset: 0; …; overflow-y: auto }`，而 `.set`（21-28）没有 `max-height`。最小窗口是 560px 高（main/index.ts:95），面板内容（头部 + 4 组 + 约 10 个 `.set__field`）700px 起步，更新失败时还挂一块 180px 的 `.set__log`——`8vh + 内容`必然溢出。
- **改成**：删掉 settings.css:18 的 `overflow-y: auto`；`.set` 加 `max-height: 100%; overflow-y: auto;`（百分比解析的是 flex 容器的内容盒高度，而 scrim 有确定高度，所以 `8vh` / `--sp-4` 只写在 scrim 一处，不用抄第二份）。
- **为什么**：app.css:28-31 写着「**窗口自己永远不滚。**……整扇窗口出现滚动条只可能是有东西撑破了布局——那时候滚动条不是补救，是把 bug 藏起来」。技术上是 scrim 在滚不是窗口在滚，但用户看到的一模一样，而那条注释管的正是观感。
- **动哪儿**：settings.css。SettingsPanel.tsx **不动**（`e.target === e.currentTarget` 那条判断本来就对，改完更严密）。
- **风险**：经典条档下从卡片内容里扣 15px，`.set` 右内边距 `--sp-5` 24px 吸收得住。`.set__head` 会随卡片内部滚走——和今天的结果一致，**不要顺手做 sticky 头**，那是另一个决定。出一张 860×560 的图确认 `--radius-lg` 圆角处滚动条被裁得干净。另：不要顺手给 scrim 的点击判据加 `offsetX > clientWidth` 补丁——Blink 命中滚动条时不向 DOM 派发 mousedown，那个 bug 不存在。

### 6. `.transcript` 补一行 `scrollbar-gutter: stable`

- **现状**：app.css:493-501 的 `.sidebar__list` 有这一行（全仓唯一），`.transcript`（723-730）没有；`.transcript__inner` 是 760px + `margin: 0 auto`。
- **改成**：app.css:723 的 `overflow-x: hidden` 之后加 `scrollbar-gutter: stable;`（**不是** `both-edges`）。同时把 app.css:498-499 的注释补上生效条件：「只在经典条下有效；overlay 条不占空间，gutter 恒为零。macOS「自动根据鼠标或触控板」这一档，插鼠标 = 经典条」。
- **为什么**：外接鼠标 = 经典条（`NSScrollerStyleLegacy`），会话长过一屏那一刻冒出 15px 滚动条，`clientWidth` 当场少 15，居中的正文列**向左跳 7.5px**——而那一刻正是首条长回复流到一半、用户正盯着看的时候。这就是 app.css:499 自己写下的「避免整列文字横向抖一下」，当时只给侧栏上了保险。
- **动哪儿**：app.css。
- **风险**：不用 `both-edges`：最小窗口 860 减侧栏 258，主栏约 602px，对比视图两栏各约 300px，`both-edges` 要吃掉 30px，撞上 compare.css:139「两栏窄，正文的 max-width 在这里没有意义，撑满更好读」。恒定偏 7.5px 比跳 7.5px 便宜。验证要接一个外接鼠标（或设为「始终显示」），触控板档下这一行恒为零宽。

### 7. 「机器原文」四块：注释说横滚、代码在折行，底色还分裂成两个 token

- **现状**：items.css:652 注释写「**横向自己滚**」，而 656 行的 `overflow-x: auto` 配上 661-662 的 `pre-wrap` + `overflow-wrap: anywhere` **永不触发**（min-content 被压到一个字符宽）。items.css:140 的 `.step__out` 只有 `pre-wrap`，遇到长路径/URL/hash 才随机冒出一条横条。底色上：`--bg-code` 4 处、`--bg-sunken` 9 处，其中 `.error__raw`(items.css:658) 和 `.set__log`(settings.css:143) 是机器原文却走了 sunken；深色下 `--bg-code` 凸 4.49 L\*、`--bg-sunken` 凹 3.16 L\*，方向相反。
- **改成**：删 items.css:656 和 items.css:140 的 `overflow-x: auto`；`.step__out` 补 `overflow-wrap: anywhere` 并**显式写出 `overflow-y: auto`**；items.css:652 的注释改成「任意处折行，不要让人横着读报错」，并指明横滚白名单在 app.css:719。items.css:658 和 settings.css:143 的 `background` 换成 `var(--bg-code)`。
- **为什么**：app.css:719 已经点名了白名单——「宽内容自己滚是既定设计（`.md pre` 有 `overflow-x`，宽表格套 `.md__scroll`）」，这两块不在上面，它们的横滚是漏的不是设计。而 `.step__out` 早就写了 `pre-wrap`，等于已经替工具输出选了「折行 > 对齐」，现在只是把另一半补上。
- **动哪儿**：items.css、settings.css。
- **风险**：**`overflow-y: auto` 必须显式写**——`visible` 不裁切，光删 `overflow-x` 会让 320px 的盒子直接溢出压住下面的对话（app.css:715-717 骂的就是这条隐式规则）。浅色下底色 ΔL\*=0.35 肉眼无变化，深色下 `.error__raw` 从凹变凸，出一张深色图确认它和外层 `.error` 卡（1px `--danger` 边框 + 透明底）叠起来的观感。**不要**顺手调浅色 `--bg-code` 的值，实测只买到 0.64 个 L\*。

### 8. `.mentions` 漏了 `.slash` 已经修过的 `overflow-x: hidden`

- **现状**：app.css:963-978 只有 `overflow-y: auto`（970 行），没有 `overflow-x`；对照 app.css:1207-1208 的 `.slash` 两条都写了，注释在 1196-1198。
- **改成**：app.css:970 前面加 `overflow-x: hidden;`（顺序与 `.slash` 一致）。
- **为什么**：横轴不写 → 按 app.css:715-717 那条规则算成 `auto`。算下来 460 − 4×2 − 8×2 − 8 = 428px，13px 等宽约 54 个字符的**基名**就撞得上——罕见，但「一张选择列表横着滚是没有道理的」这句对 `@` 列表同样成立。
- **动哪儿**：app.css。
- **风险**：**`.mentions__name` 的 `flex: none`（app.css:1002）不要动**。去掉之后两个 flex 项按基准宽分摊收缩量，长目录 + 短文件名会让文件名在明明放得下的时候被截——正面推翻 app.css:1006「目录压成次级信息**并允许被挤掉**——找的是文件名」。用一个罕见 bug 换一个常见 bug。

### 9. 侧栏底部那一行破了「只有两个量」的规矩

- **现状**：app.css:67 原文「**要加新东西，用这两个变量，不要再写第三个 padding。**」而 app.css:365 `.foot { padding: var(--sp-1) calc(var(--sb-pad) - 2px) var(--sp-2) }`、app.css:376 `.foot__who { padding: 5px 6px }`、app.css:404 `.foot__slot { width: 18px }` 是第三、四、五个横向量。实测：`.row__slot` 中心 x=20 / 头像中心 x=21，`.row__label` 左=32 / `.foot__name` 左=38，`.row` 高 32 / `.foot__who` 高 30.8。
- **改成**：`.foot` 的 padding 横向回到 `var(--sb-pad)`；`.foot__who` 改 `gap: 0; padding: 0; min-height: var(--sb-row-h)`；`.foot__slot` 宽改 `var(--sb-slot)`；SidebarFoot.tsx:67 把 `.avatar` 包进一个 `<span className="foot__slot">`（和没账号时的齿轮走同一条列）。`.avatar` 保持 18×18。
- **为什么**：实测改后图标中心 20/20、文字左 32/32、行高 32/32、`.foot__act` 中心距内容右边 21 = `.row__act` 的 21。顺带把 app.css:397-398「图标占的位置要和头像一样宽，否则换个引擎登录一下，整行的文字会横向跳一格」从「两处巧合都写 18」变成结构上的必然。
- **动哪儿**：app.css、SidebarFoot.tsx。
- **风险**：`.foot__who` 30.8 → 32、`.foot` 43.8 → 45（**+1.2px，不是 +4**），会话列表可视区少 1.2px。`.foot__act` 左移 2px，app.css:419-424 那条注释只锁了「平时就带底色」和「不用胶囊」，没锁位置。

### 10. `.turnmark` 的负外边距留在了旧 DOM 上：同一行的两样东西差 4px

- **现状**：items.css:434 `.turnmark { margin-top: calc(var(--sp-2) * -1) }` 还在，而 items.css:665-670 的 `.turnmark__row` 是后加的，Transcript.tsx:89-114 把它和 `.turnmark__act` 一起包了进去。实测「已处理 X」文字中心 y=5.2、「从这里重来」中心 y=9.2，**差正好 4px**，`.turnmark` 边框盒还往行外溢出 6px。
- **改成**：负边距从 items.css:434 移到 `.turnmark__row`（items.css:666）；items.css:474 的 `.think { margin: -8px 0 }` 同理移到真正的 flex 项上：`.copyable:has(> .think) { margin: calc(var(--sp-2) * -1) 0 }`（写法照 items.css:359 已有的 `.copyable:has(> .msg--user)`）。
- **为什么**：`align-items: center` 对的是**外边距盒**，负边距因此参与交叉轴计算——压缩的不是行距，是它自己在本行里的位置。这条只能靠算，肉眼看是「两个字莫名其妙高一点」。
- **动哪儿**：items.css。
- **风险**：turnmark 与上一条的视觉净距 10 → **8**，与下一条 18 → 16——上下各紧 2px，不是「零变化」。想原样保留要写 `-6px`，那是个不在 `--sp` 阶梯上的裸数，不值得。注释里必须写死「这一条必须挂在 `.transcript__inner` 的直接子节点上」，否则下次 DOM 一变又漂。对比视图走同一套 DOM，跟着一起修。

### 11. 引擎历史段：时间戳画成警告黄，整段多缩进 24px

- **现状**：ForeignRow.tsx:41 用 `.row__note`（app.css:609-615，`color: var(--warn)`）渲染「3 分钟前」；ForeignRow.tsx:28 是 `row row--thread` 但**没有 `row--flat`**，于是吃到一级缩进：文字起点 8+24+24 = 56px，而同段的 `.sidebar__empty` 是 32px。
- **改成**：ForeignRow.tsx:41 `row__note` → `row__aside`；:28 加上 `row--flat`。
- **为什么**：时间戳是「行右侧的一小段附注」，`.row__aside`（app.css:466）的注释开头就是这句；`.row__note` 是「一行字说清状态点说不清的事」（app.css:608）。缩进那条的语义是「它属于上面那个项目」（app.css:491-492），而这一段上面没有项目行。
- **动哪儿**：ForeignRow.tsx。
- **风险**：`.row__aside` 带 `max-width: 62px` 会截断。量过：最长输出「59 分钟前」11.5px 下约 50px，扣掉 `padding-right: 4px` 还剩 58px 可用，**刚好不截**。以后 `whenOf` 加更长的说法要重新量，或把 62 提到 68（84px 会把标题截成「给 m.js 的 a…」，见 app.css:467）。

### 12. 对比视图路径列缺 `<bdi>`，开头那个 `/` 被甩到行尾

- **现状**：compare.css:68-78 `.cmp__path { direction: rtl; text-align: left }`，Compare.tsx:55 是裸 `<code className="cmp__path">{file.path}</code>`。UBA 手推 `/w/a.ts`：开头的 `/` 经 W6 → ON、N2 取嵌入方向落到 level 1，屏幕上是 `w/a.ts/`——**与溢出无关，每一行每一次都错**。
- **改成**：Compare.tsx:55 → `<code className="cmp__path"><bdi>{file.path}</bdi></code>`。CSS 一行不动（`direction: rtl` 负责把省略号放到左边）。
- **为什么**：同一个坑 SidebarMenus.tsx:60-65 已经写明注释并用 `<bdi>` 修好过（宿主是 popover.css:211 的 `.pop__head-path`），EnvCard.tsx:64 是第二处。这是第三处该用、第二处漏用。
- **动哪儿**：Compare.tsx，compare.css:74 补一行注释指回 popover.css:211，别有第四处。
- **风险**：`<bdi>` 是行内元素、默认 `unicode-bidi: isolate`，不影响 `.cmp__path` 的 `flex: 1` / `min-width: 0` / ellipsis——text-overflow 由块容器在行盒上做。同样的组合在 `.pop__head-path` 上已经跑过一版。

### 13. `.changed__pill` 补 `font-variant-numeric: tabular-nums`

- **现状**：items.css:608-618 只有 `font-size: var(--text-xs)`，而 items.css:602-606 的 `.changed` 是 `justify-content: center`，tool.ts:134-151 每次 item 更新都重算 files/added/removed。全仓已有 9 处 tabular-nums，status.css:81 的注释是「等宽数字：秒数跳动时整行不会左右抖」。
- **改成**：items.css:608 加一行 `font-variant-numeric: tabular-nums;`。
- **为什么**：居中 + 活值 = 宽度一变左右各挪半格。agent 跑一轮全程可见，这是唯一一处「数字在变 + 元素居中」的组合。
- **动哪儿**：items.css。
- **风险**：胶囊静态宽 +1~3px，它居中，不挤任何东西。**不要**再给 `.diffstat__add/--del` 写一条：`font-variant-numeric` 可继承，一条就全覆盖；而且那两处渲染出来就不再变，本来不抖。

### 14. 空态那个大图标是手写 `<svg>`，笔画 2.76px

- **现状**：Transcript.tsx:24 `width="34" viewBox="0 0 16 16" strokeWidth="1.3"` → 渲染笔画 1.3 × 34/16 = **2.7625px**，是 `STROKE_PX = 1.25` 的 2.21 倍；它装在 62px、`border: 1px` 的 `.blank__glyph` 里。
- **改成**：`import { TerminalIcon } from "./icons-activity.js"`，把 Transcript.tsx:23-33 那块手写 svg 换成 `<TerminalIcon size={34} />`（画的本来就是同一个 `>_`，路径几乎一样）。
- **为什么**：icon-base.tsx:58-59 写着「**给它开个口子，而不是让它自己写 `<svg>`**——自己写就拿不到上面那套笔画补偿，实测四个图标就是这么漏掉的」。这是第五个漏网的，而且尺寸最大、误差最大，正好摆在空会话首屏唯一的图形位置上。
- **动哪儿**：Transcript.tsx。
- **风险**：第一眼会觉得「变淡了」。如果出图后觉得这个锚点该更重，正确做法是 `size={40}` 或把 `.blank__glyph` 的 border 加到 1.5px，**不是**回去调 strokeWidth——icon-base.tsx:31「**「多大」和「多重」在这里解耦**」。

### 15. 侧栏搜索框聚焦：`--border-strong` 是 1.16:1 的指示，等于没有

- **现状**：app.css:255-257 `.row--search:focus-within { border-color: var(--border-strong) }`，app.css:271-273 `.sidebar__filter:focus { outline: none }`——系统焦点环被关掉了，替代品是 #e6e6e9 → #d6d6da，互比 **1.163:1**（深色 1.18 → 1.49）。
- **改成**：app.css:256 → `border-color: var(--accent);`（对齐 items.css:324-326 的 `.composer__inner:focus-within`）。
- **为什么**：这是键盘进侧栏的第一站，也是这个框**唯一**的焦点指示。tokens.css:6「强调色只用于焦点与链接」——焦点这半边正好靠它兑现。
- **动哪儿**：app.css。
- **风险**：零。全局焦点环那件事不在这条里（见第 34 条）。

### 16. 一个 24px 的胶囊挂着浮层专用的阴影

- **现状**：settings.css:133 `.seg__item--on { box-shadow: var(--shadow-pop) }`，而 tokens.css:80-88 那条 token 的注释写的是「**浮层的阴影**」。实测 `.seg__item` 约 24px 高，深色那道是 `0 10px 32px / 55%`——向下扩散约 26px，**比控件本身还高**，`.seg` 和 `.set` 都没有 overflow 裁剪，那团黑晕直接糊到下一条设置项上。
- **改成**：tokens.css `:root` 新增 `--shadow-1: 0 1px 2px rgb(0 0 0 / 6%);`，深色段里 `--shadow-1: none;`；settings.css:133 换成 `var(--shadow-1)`。
- **为什么**：深色下不需要阴影——`--bg-raised`(L\*=10.96) 与 `--bg-sunken` 轨(L\*=4.75) 已经差 6.2 L\*，这正是 tokens.css:82-83「深色下阴影几乎看不见（黑上加黑），得靠一条更亮的描边来划边界」的直接推论。
- **动哪儿**：tokens.css、settings.css（若第 4 条已改名则是 `.switch__item--on`）。
- **风险**：`.tobottom`（app.css:1110）也挂着 `--shadow-pop`，但那颗是真的浮在滚动内容之上，**不动**，出图时确认一眼即可。

---

## 第二批 · 值得做

要动多处或新加一个机制。每条都点明了必须验的东西。

### 17. 等宽正文钉在 11.5px（附注档），行内代码却是 12.9px

- **现状**：tokens.css:62 `--text-xs: 11.5px` 同时喂给附注和全部等宽正文（markdown.css:109、items.css:137、items.css:89、diff.css:91、items.css:660、settings.css:146），而 markdown.css:92 的行内 code 是 `0.92em` = 12.88px。工具行还倒挂：`.step` 13px 的概括和 11.5px 的具体命令**并列同屏**（ToolRun.tsx:160-186 展开后折叠按钮继续渲染）。
- **改成**：tokens.css 在 `--text-xs` 后新增 `--text-code: 12.5px`，注释写死用途边界：「只给等宽正文；它不是第六档 UI 字号，UI 文字仍只有 xs/sm/base/lg/xl 五档」。上述 6 处引用改用它；markdown.css:92 的 `0.92em` 不动；`.crash__stack`（app.css:**896**，不是 897）和 compare.css:77/84 留在 `--text-xs`。
- **为什么**：tokens.css:51-61 那段的原话是「桌面应用的正文没有理由比系统默认（13）还小」——代码块不是附注，同一条推理再往下延一格。760px 列宽下 11.5 → 12.5 是 106 → 98 列，够。
- **动哪儿**：tokens.css、markdown.css、items.css、diff.css、settings.css。
- **风险**：`.step__target` 的行盒 18.4 → 20px，**每条工具行长高约 1.6px**，40 行的活动区累计 +64px。静态样张必须包含一段 30 行以上的连续工具活动，不能只截一个代码块就定稿。

### 18. 审批卡上的命令原文用比例字体 600 重排

- **现状**：Approval.tsx:91 是 `<div className="approval__title">需要确认：{item.summary}</div>`，items.css:177-181 只有 `font-weight: 600`，字号字体继承 body 的 14px + `--font`。而 app.css:1082 自己写过：「路径用等宽：它是要被读准的东西，比例字体下 l/1/I 分不清」。Approval.tsx:25 的头注是「**整个产品最关键的界面**」。
- **改成**：Approval.tsx:91 拆成 `<span className="approval__label">需要确认</span>` + `<code className="approval__cmd">{item.summary}</code>`；`.approval__title` 改 `display: flex; align-items: baseline; gap: var(--sp-2); margin-bottom: var(--sp-2); font-size: var(--text-sm);`（**这句字号是关键**，否则 `.approval__label` 在这里 14px、在下面「原因」行 13px，同卡两个号）；新增 `.approval__cmd { min-width: 0; font-family: var(--font-mono); font-size: var(--text-base); font-weight: 500; color: var(--text); overflow-wrap: anywhere; }`。
- **为什么**：`item.summary` 形如 `执行 rm -rf ./build`、`读取 /tmp/x`——要被读准的正是路径和命令那半截。字重 600 → 500：等宽 + 满色 `--text` 已经说清这是主语，600 的等宽在 14px 上偏糊。
- **动哪儿**：Approval.tsx、items.css。
- **风险**：这是全仓第一处「整句中文常驻等宽字体」（`.step__target` 只在多文件那一支有中文，`.seg__value` 没有），`--font-mono` 链里没有 CJK 字形，「执行」会兜底到 PingFang SC 和 SF Mono 拼在一行。按 docs/工程时间线.md:1938 那套静态样张出四张图：浅/深 × `执行 rm -rf ./build` / `修改 /w/a.ts、/w/b.ts`。别扭的话退到 13px + 500，**不是**退回比例字体。SettingsPanel.tsx:166 的路径不在这条里（`Field` 的 `hint` 是 `string`，改了会连整句中文一起变）。

### 19. 全仓 3803 行样式里 `:active` 出现 0 次

- **现状**：`grep -rn ':active' styles/ components/` = 0 命中，`:hover` 52 处。ComposerAction.tsx:54-61 甚至为「点下去要立刻有反应」在 JS 里补了个 `useState`。
- **改成**：规则是「press 在 hover 的**同一个通道**上再走一档」，绝大多数选择器不需要新 token：hover 是 `--bg-hover` 的 → press 用 `--bg-active`；hover 已经是 `--bg-active` 的（只有 `.foot__act`）→ press 用新增的 `--bg-press`（浅 **#e0e0e5**、深 **#35353d**）；hover 只改 color 的（`.step--open`）→ press 也只改 color；近黑主按钮 → `.btn--primary:active { opacity: .78 }` 写在 items.css:280 之后。按下态**不加 transition**。
- **为什么**：macOS 上按下与松开之间那一百毫秒是「系统收到了」的唯一凭据；hover 说的是「这儿能点」，不是「我点了」。
- **动哪儿**：tokens.css（`--bg-press` 两套）、app.css、items.css、popover.css、status.css。
- **风险**：四个选择器必须写成排除式，否则引入新 bug——`.row:not(.row--search):active`（`.row--search` 是假输入行，app.css:251 已经把它的 hover 顶回 `--bg-raised`）、`.pop__cmd:not(.pop__cmd--danger):active`（否则按下「删除」那一瞬红色被灰色盖掉）、`.btn:active` 用 `--bg-active` 而**不是** `--bg-press`（后者和 `.btn` 自己的 `--border-strong` 描边只差 1.05:1，按下去边框会消失）、底色写在 `.row` 上而不是 `.row__main`（后者 transparent 且不含右边的 `.row__act`）。`.seg__item:active` **整条别写**——那个控件「选中 = 更亮」，给未选中项一个深色 press 是反着来。`--bg-press` 的值按 docs/工程时间线.md「侧栏底部」那次的做法出图定（浅色灰阶步长是 7-8，#dcdce2 跨了 12 且离 `--border-strong` 只剩 6）。

### 20. 动效没有 token；`prefers-reduced-motion` 漏掉的正好是仅有的两处真位移

- **现状**：全仓 `transition` 正好 5 条（items.css:378、items.css:684、app.css:765、app.css:1166、**icons.tsx:58 行内**），同一件「浮现」写了四遍 120ms。已有 5 处 reduce 块全是原地循环动画；漏的两处是 icons.tsx:58 的 chevron 转向（行内 style，媒体查询盖不住）和 useStickToBottom.ts:90 写死的 `behavior: "smooth"`——**全应用位移最大的一段动画**。`grep matchMedia` = 0 命中。
- **改成**：tokens.css 加 `--dur: 120ms` / `--dur-slow: 240ms` / `--ease: ease`，值与今天逐字节相同，迁移 4 处 CSS。icon-base.tsx:52-62 的 `Svg` 签名加 `className` / `data-open`（**同一个口子的另一半**），chevron 从行内 style 移到 `.chev` 三条 CSS 规则，reduce 块里留旋转、只去掉 tween。useStickToBottom.ts:90 改成 `const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches` + `behavior: smooth ? "smooth" : "instant"`。app.css:1147 那个已有的 reduce 块里补一行 `.meter__fill { transition: none }`。
- **为什么**：CSSOM View 里只有 `behavior: "auto"` 才去查 CSS 的 `scroll-behavior`，显式传 `"smooth"` 任何 CSS 都拦不住。这条 token 化本身是洁癖，值钱的是 **icons.tsx:58 从此不再是规则体系外的唯一一条过渡**。
- **动哪儿**：tokens.css、app.css、items.css、icon-base.tsx、icons.tsx、useStickToBottom.ts。
- **风险**：`Svg` 的 props 是显式写死的，加字段前传 `className` 会 typecheck 报错——不会静默失败。加 `className` 不推翻 icon-base.tsx:58「给它开个口子，而不是让它自己写 `<svg>`」，图标仍走 `Svg`、仍拿得到笔画补偿。**每次点现读一次 matchMedia，不要缓存到模块顶层**（AGENTS.md 反模式，且用户中途改设置能立刻生效）；写 `"instant"` 而不是省略 `behavior`。**不要加 `--dur-fast`，不要改曲线**——「ease 对 120ms 太软」是手感断言不是实测，而这个仓库对手感改动的标准是出图比稿。落地后真机打开「减少动态效果」验一次。其中 useStickToBottom 那两行可以单独先落，零风险。

### 21. 设置面板是最上层的模态，却是唯一按 Esc 关不掉的浮层

- **现状**：SettingsPanel.tsx 全文没有 keydown / Escape / focus；`grep Escape` 命中的七处浮层里没有它。settings.css:9-12 的 z-index 60 是最高的一层。Popover.tsx:20-21 写着「**Esc 要关**，并把焦点还给触发器。不还的话焦点掉到 body 上，键盘用户就此迷路」。
- **改成**：抽一个模块级 `useModalKeys(onClose)` 返回 ref，组件里只留一行调用；面板加 `aria-modal="true"` / `tabIndex={-1}` / 初始 `.focus()`。监听挂 `window` 的**冒泡阶段**。
- **为什么**：SettingsPanel.tsx:12-13 防的是「改到一半手滑就得重来」，而「点外面就关」这个行为已经在跑（:108-112 带 `e.target === e.currentTarget` 判据）——Esc 比已经上线的那个风险更低，不是推翻。
- **动哪儿**：SettingsPanel.tsx（+ 一个 hook 文件）。
- **风险**：**不要用 capture**。实测派发顺序是 `window-CAPTURE → document-CAPTURE → window-BUBBLE`——捕获由外向内，window 在 document 外面，而 Popover 的 Esc 挂在 document 上（Popover.tsx:118）；用 capture 会让设置面板抢在内层浮层之前关掉自己。「谁先注册谁先收到」只在同一个节点上成立。另：`SettingsPanel` 函数体现在是 88/100 有效行，**内联写 effect 会让 `pnpm lint` 报错**，必须提到模块级。焦点陷阱先不做。

### 22. 工具行展开出来的三样东西，左边缘是 0 / 22 / 24

- **现状**：实测相对 `.run` 内容左边界：`.step__verb` 左 24、`.step__out` 左 **0**（items.css:131）、`.diff` 左 **22**（diff.css:10）、`.think__body` padding-left 24（items.css:568）。22 和 7 在仓库里没有任何注释。
- **改成**：`.transcript__inner`（app.css:732）里定义 `--step-icon: 16px` 和 `--step-slot: calc(var(--step-icon) + var(--sp-2))`（= 24px，照 `.sidebar` 挂 `--sb-*` 的先例）；`.step__icon` 宽改 `var(--step-icon)`；`.step__out` 和 `.diff` 各补 `margin-left: var(--step-slot)`；`.think__body` 的 24 换成同一个来源；`.run__nested` 的裸数 7 写成 `calc(var(--sp-2) - 1px)` 并注明「轨线右边缘正好压在父图标中线 8 上，那 1px 是描边自己」。
- **为什么**：app.css:129-132「差几个像素就是「差不多齐」，而「差不多齐」比明显不齐更难看」。`.step__out` 顶到 0 会被读成「和左轨平级的另一段内容」，而它是这一行的详情。
- **动哪儿**：app.css、items.css、diff.css。
- **风险**：**左边距必须单独一条声明，不能写进 `margin` 简写**——变量哪天没定义，整条简写作废，上下那 2px / 8px 会一起丢（第 1 条那批 bug 的同一个机制）。`.step__out` 可读宽 747 → 723，80 列等宽约 552px，够。对比视图走 `.cmp__pane .transcript__inner`，同步生效。

### 23. 侧栏分节标题：全仓最后一处硬凑对齐，凑完还差 2.4px

- **现状**：app.css:315-319 有 `align-self: flex-end` + `margin-bottom: 1px`，注释写「段标题上那颗按钮比行内的低一点点——它要和已经往下压过的标题基线对齐」。实测标题文字中心 y=26.40、按钮中心 y=28.80，**差 2.40**（普通行是 0.01）。成因是 16/4 的不对称内边距挂在子元素 `.sidebar__section-main` 上，另一个子元素没有参照。
- **改成**：留白挪回容器 `.sidebar__section`：`padding: var(--sp-4) 0 var(--sp-1) var(--sb-slot)`，**并加 `min-height: calc(var(--sp-4) + var(--sb-act) + var(--sp-1))`（= 42）**；`.sidebar__section-main` 去掉 padding；app.css:315-319 整块删掉。
- **为什么**：实测改后三种段头都是 42，标题中心 26.99 / 按钮中心 27.00。顺带修掉一处没人提的：SidebarHits.tsx:30 的「命中 N / M」用的是 `--static`，没有 `-main` 子元素，**今天纵向内边距是 0**（实测高 20.8），紧贴上下两行。
- **动哪儿**：app.css。
- **风险**：`min-height` 不能省——那颗按钮是 `.row__act`（`--sb-act` 22）比标题的 20.8 高，不锁的话「有 +」的段 42、「没 +」的段 40.8，四种段头不一样高。42 落在 `--sb-act` 上而不是 4px 栅格上，这点要认：`--sb-act: 22` 是 app.css:73-77 量出来的（「图标 15、盒子 22，四边各留 3.5」），不该为凑倍数动它。`padding-left: var(--sb-slot)` 合并进简写时别写漏，它承担 app.css:286-287「分节标题对着文字列，不对图标列」。

### 24. 输入框里有四条左边缘：13 / 15 / 21 / 22

- **现状**：实测 `.composer__inner` 内容左 13、`.chip` 图标左 **21**、打的字左 **15**（textarea 没重置 UA 的 `padding: 2px`）、`.trigger` 图标左 **22**。`.chips { gap: var(--sp-1) }` 写的 4，两枚芯片之间**视觉间隙实测 20**（4+8+8）——`.chip` 有左右 8px 内边距却没有底色也没有描边（Chips.tsx:52-64）。
- **改成**：`.chip { padding: 2px 0 }`（`border-radius: 999px` 一并删，它画不出东西）；`.chips { gap: var(--sp-3) }`；`.composer__input { padding: 0 }`；`.composer__bar { margin-left: calc(-1 * (var(--sp-2) + 1px)) }`（照 app.css:645-646 的 `.topbar__title` 那套）。
- **为什么**：改后实测四条边缘都落在 13，芯片视觉间隙 12——`gap` 说的话终于是实话。
- **动哪儿**：items.css。
- **风险**：**输入框会变矮 4px 不是变高**（textarea 没有 `rows`、不自动撑高，实测 48.78 → 44.78；`min-height: 42px` 本来就没参与，不用改）。触发器 hover 底色会伸进 `.composer__inner` 的内边距区，算过：离底 9px 处 `--radius-lg` 圆弧 + 描边横向占约 1.63px，触发器左边缘在 4，最窄剩约 2.4px，浅色出过图看着安全，**深色再出一张**（`--border-pop` 更亮，边界更显眼）。

### 25. 「恢复默认设置」上面那道分隔线一条都没生效

- **现状**：app.css:1547-1553 写了 `border-top` / `padding-top` / `color: var(--text-muted)` / `border-radius: 0`，但 main.tsx 把 popover.css 排在 app.css 之后，同权重下 `.pop__item` 基类整块盖掉——实测生效值是 `border-top-width: 0px`、`color: rgb(22,22,26)`，只剩 `margin-top: 4px` 活着。app.css:1531-1535 的 `.pop__item--row` 同理失效。
- **改成**：把 app.css:1527-1586 整段 `.pop__*` 迁进 popover.css，放在 `.pop__item:hover`（popover.css:101-103）之后——覆盖关系自然成立，不用提权重、不用 `!important`。注释里写死「**必须写在 `.pop__item` 之后**」这个理由。顺带两处不在 `--sp` 阶梯上的裸数：app.css:1281/1283 的 `5px` / `9px` → `var(--sp-1)` / `var(--sp-2)`；popover.css:201 `.pop__head` 的 `padding: var(--sp-2) var(--sp-3) var(--sp-3)` → `var(--sp-2)`（纵向对称，横向跟同浮层里 `.pop__title` 已有的 8 对齐）。
- **为什么**：注释争取的效果一天都没兑现过——「不分开的话，人会在选项列表里数到它」描述的正是现在的屏幕。
- **动哪儿**：app.css、popover.css。
- **风险**：**`border-radius: 0` 那一行不要恢复**——hover 时会在一个 9px 圆角浮层的最底下留一个直角色块，而注释要的是「画一道线」。迁移前确认没有第三份同名规则（grep 过，只有这两个文件）。`.pop__head` 横向 12 → 8 让右键菜单抬头左移 4px，出图看一眼再合。**不动** `.pop__section + .pop__section`（已对称）和 `.env__acts`（那是卡片下的一排按钮，不是分节抬头）。

### 26. 侧栏与正文之间那条结构边，和弹层里的装饰线是同一个 token

- **现状**：app.css:54（`.sidebar` border-right）、app.css:634（`.topbar` border-bottom）、items.css:309（`.composer` border-top）、compare.css:127（`.cmp__pane + .cmp__pane`）四条布局级分区用的都是 `--border`，和 popover.css:76 / settings.css:72 / markdown.css:143 那些面板内装饰线完全同一个。浅色下 #e6e6e9 对左边 `--bg-sunken` 只差 5.9 L\*，而两侧底色互差 2.76——三个颜色全挤在一起。
- **改成**：这四条换成 `var(--border-strong)`，**token 值一个不动**。口径写在 tokens.css:21-22 旁边：`--border-strong` = 把窗口切成区块的那几条 + 控件轮廓；`--border` = 区块内部的分节线。
- **为什么**：换完浅色下 ΔL\* 差不多翻倍（对 sunken 5.9 → 11.5、对 bg 8.6 → 14.3），而一个控件都不会跟着变。popover.css:5-7 已经写过同一个观察（「只有边框的浮层在浅色背景上「浮」不起来」），当时只在浮层那一处解决了。
- **动哪儿**：app.css、items.css、compare.css、tokens.css（注释）。
- **风险**：**`.foot`（app.css:366）不在名单里**——它在侧栏内部、两侧同底色，是分节不是骨架。深色下四条骨架线会同时亮一档（对 `--bg` 从 +9.4 到 +16.8），**这是唯一要出图确认的地方**；显重的话退路是给深色单独保留 `--border`，但那要新加 token，先看图。**明确不做**把 `--border-strong` 的值加深：会连带 8 处控件轮廓，含 items.css:159 注明「**整个产品的关键界面**」的审批卡，而且深色下这条边本来就不弱，再加重是往「厚边框」漂。

### 27. `--text-faint` 浅深不等价；代码注释是全场最淡的一个

- **现状**：tokens.css:27 `#9a9aa4` on 白 = **2.788:1**，tokens.css:113 深色 `#6d6d78` on `--bg` = **3.497:1**——同一个角色两套主题差 25%。73 处引用里包括 settings.css:91 的 `.set__hint`（那里写着「**说明必须写全**」）和 markdown.css:164 的 `.hljs-comment`（11.5px + 斜体 + 2.58:1，而 `--hl-keyword` 5.05、`--hl-string` 7.03）。
- **改成**：markdown.css:164 `.hljs-comment, .hljs-quote` → `var(--text-muted)`（2.58 → 5.06:1）。tokens.css:27 `--text-faint` → `#85858f`（on 白 = **3.66:1**，与深色那侧的 3.50 对齐）。`--text-muted` 两侧都不动。
- **为什么**：markdown.css:158 的原话是「关键字/字符串/**注释三档拉开就够读**」——它要的是三档拉开，没说注释必须是全场最淡的那个。而注释是代码里最接近散文、最需要逐字读的部分。
- **动哪儿**：markdown.css、tokens.css。
- **风险**：只在**浅色**下有变化，深色一个像素不动。`--text-faint` 与 `--text-muted` 仍差 10.6 L\*，层级不塌；items.css:151-155「`.step__out--live` 比展开态更淡」那条相对关系原封不动。要不要再往上推到 4.5:1 见第 35 条——那是基调选择，不是 bug。

### 28. 「正在运行」和「等你批准」在两处用了同一个 `--warn`

- **现状**：items.css:126-128 `.step__state--running { color: var(--warn) }`，而 app.css:583-585 `.row__dot--waiting` 也是 `--warn`（`.row__dot--running` 是 `--ok`）。同一个颜色隔一屏两个意思。
- **改成**：items.css:127 → `var(--text-muted)`。把 `--warn` 严格留给「需要你做点什么」：侧栏 waiting 点、`.row__aside--warn`、`.foot__act--warn`、`.notice`、`.chip--warn`。
- **为什么**：只有「正在跑」不是那个意思。**不能改成 `--ok`**：同一个 `.step__state` span 在文件编辑完成时装的正是 `.diffstat__add`（items.css:144-146，绿色 = 新增行数），绿色在这一格已经有别的含义。
- **动哪儿**：items.css。
- **风险**：要接受一个代价——ToolRun.tsx 的工具行里**没有转圈图标**（全仓 `SpinnerIcon` 只在侧栏三处），颜色是「运行中」三个字之外唯一的信号。改完只靠 `--text-muted`（比 `.step__state` 基色 `--text-faint` 深一档）区分。可接受的理由是旁边还有 ToolRun.tsx:110 的 live 逻辑（跑着时自动摊开输出尾部），而且 app.css:578 写着「侧栏是唯一能一眼看出「哪个会话还在跑」的地方」。

### 29. 引擎启动期：文案说反了，而且这时候回车会丢一条消息

- **现状**：Workspace.tsx:150 把 `starting` 并进 `busy`，启动期 `capabilities` 未定义 → `canSteer = false` → 屏幕上显示「它还在跑——现在打的会排在后面，这一轮停了就发出去。」**什么都没在跑**。而 Prompt.tsx:91-92 那条本该说实话的 `busyHint` 分支被前两支穷尽，**永远走不到**。更要命的是 Composer.tsx:130 `const blocked = detached`——输入框**没被禁**，回车会先 `setText("")` 清空，再撞上 host prompt.ts:92 的 `ctx.live.get(threadId)`（`live.set` 要到 session.ts:162 才发生）抛「会话不存在」。session.ts:250-253 的注释还写着「界面上有了、**输入框是禁的**」。
- **改成**：`Composer` / `Prompt` 加 `starting: boolean`（`busy` 保留，它还管「上一轮没跑完」）；文案链最前面插一支「引擎正在启动，起来就能发。」；**把 `busyHint` 整个删掉**；`ComposerAction.Action` 在 starting 时渲染一颗 `disabled` 的 `.send`（不是 `.send--stop`）；Composer.tsx:130 → `const blocked = detached || starting`。转录区改 `Blank`（不是 `TurnStatus`）：starting 时把 `.blank__title` 换成 `<Shimmer text="正在启动引擎…" />`，保留 cwd。
- **为什么**：Transcript.tsx:15-16 已经把需求原封不动写出来了——「**这是新会话、还是在加载、还是坏了？** 一句话就能把三者区分开」，而今天 starting 和 idle 显示同一句。新建会话是 provisional 的，侧栏里连那行「启动中」都没有，整屏零反馈。`blocked` 那一行是这条里唯一真正防丢数据的改动。
- **动哪儿**：Workspace.tsx、Composer.tsx、Prompt.tsx、ComposerAction.tsx、Transcript.tsx。
- **风险**：影响面只有**新建**会话和**接管**（`thread.adopt`）两条路——点「继续」走 `resume` 直接是 `idle`、切引擎根本不改 status，两条都不经过 `starting`。落地后真机跑一次新建会话，确认 `starting → idle` 只跳一次、文案不抖两下。不要动 `TurnStatus`：那个文件的注释把自己定义成「**一轮跑起来之后**」的状态行。

### 30. 缩略图把「还没取到」和「取不到」当成同一件事

- **现状**：`useThumb`（ImageThumb.tsx:30-45）初值 `undefined`，ImageThumb.tsx:72 和 :127-128 拿同一个 `undefined` 同时表示两件事。`Lightbox` 用 `FULL_PX = 2000` 重取，主进程那边是同步的 `createFromPath` + `resize`——**成功路径上必然先渲染一次「这张图打不开了：/Users/…」**。小图那边占位是 36.4px 的文件名块、加载完是 74px，整排附件当场往下顶 37.6px。
- **改成**：`useThumb` 返回 `{ state: "loading" } | { state: "ok"; url } | { state: "miss" }`（IPC resolve 出 `undefined` 才是 miss——main/attach.ts:66 明写「不抛，返回一张空图」，所以 miss 分支可达）。loading 时小图渲染 `.thumb__skel`，**尺寸必须和最终 `<img>` 逐字一致**（`width: 72px; height: 72px; background: var(--bg-sunken)`）；灯箱复用 `.lightbox__miss` 只换文案「正在打开…」。
- **为什么**：Attachments.tsx:5-6「**必须显示出来。** 贴完图什么都不变的话，人不知道它收没收到」——现在它显示的是一句假话，然后整个转录区被顶下去 37.6px。
- **动哪儿**：ImageThumb.tsx、app.css。
- **风险**：`useThumb` 两个组件共用，改返回类型两处都要跟（文件现 134 行，闸门 200）。**不要给占位块加骨架扫光**——200ms 就结束了，静态灰块够，而且这个仓库对「一刻不停的动画会持续抢注意力」有明确态度。圆角不用写，`.thumb__hit` 自己 `overflow: hidden`（第 1 条把它的圆角修好后一并裁）。

### 31. 冷启动第一屏借用了「推理引用块」的样式

- **现状**：screens.tsx:30-38 的非致命分支落在 items.css:30-35 的 `.reasoning`（左边一条 2px 竖杠 + `--text-muted` + 13px），装在 760px 居中列里，「正在打开工作区…」贴在左上角。而应用里已经有一整套为「这里什么都没有」做的版式（`.blank`，app.css:1044-1088）。
- **改成**：非致命分支换成 `.blank` 那套：`.blank__glyph blank__glyph--spin` 里放 `<SpinnerIcon size={34} />` + `.blank__title`「正在打开工作区…」。app.css 加 `.blank__glyph--spin svg { animation: row-spin 900ms linear infinite }` 并**配一条 `prefers-reduced-motion` 关掉**（现有三处旋转动画每一处都配了）。转圈必须是条件的：只有 `!bridgeMissing && notices.length === 0` 那一支画转圈，另两支用静态文案、致命那支保留 `.error` 红框，可以给它挂一颗「打开日志」的 `.btn`。
- **为什么**：拿转录区里 agent 推理块的样式画应用级加载态是语义错配——将来调 `.reasoning` 会莫名改到启动屏。
- **动哪儿**：screens.tsx、app.css。
- **风险**：**不复用 `.row__spin`**——app.css:454-455 写着「那条带着行内的外边距，落到一颗圆键的正中央会把图标推偏」，单独给一条 animation。**不要给 `.blank` 加 drag**：它和转录区空态共用（Transcript.tsx:21），加了等于让转录区空白也能拖窗口，还会把里面的东西变成不可点（第 3 条同一个坑）。**不做**「8 秒换文案 + 重试按钮」：两家驱动的握手上限都是 20 秒（codex/driver.ts:25、acp/open.ts:27）且会抛，横幅会自己带着原因过来——多加一层猜测只会让两句话打架。

---

## 第三批 · 想清楚再做

会推翻已写明的决定，或需要真机反复量。

### 32. 发送键从强调色改回近黑

- **现状**：app.css:1163 `.send { background: var(--accent) }`，而同一个 `ComposerAction.tsx` 里第三态 `Resume` 走 `.btn--primary`（items.css:273：`background: var(--text)`）——同一颗控件两套规矩。
- **改成**：`.send { background: var(--text); color: var(--text-inverse) }`（第 1 条已经把 hover 改成 `opacity: .88`，不用再动）。
- **为什么**：tokens.css:6 的原文是「**强调色只用于焦点与链接；主按钮用近黑，不用彩色。**」对比度浅 17.96:1 / 深 15.16:1，与 `.btn--primary` 完全一致。
- **动哪儿**：app.css。
- **风险**：这里有两条互相打架的写明决定——app.css:1179「**停止不用主色：主色是「往前走」，而停止是打断**」预设了发送键就该是主色。我的判断是 tokens.css:6 层级更高、该赢，改完 1179 那句注释相应改成「停止不用主键的重量」。**但这是一次可见的视觉变更，该由作者拍板，不要夹进修死引用的提交里。** 若决定保住彩色发送键，就必须把 tokens.css:6 那条注释一起改掉并写明理由，不能两份文件各说各话。

### 33. 垂直节奏没有基准：同一种「列表行」有 28.8 / 30.8 / 32.8 三种高

- **现状**：实测 `.mentions__row` 28.8、`.step` 28.8、`.pop__item` 30.8、`.menu__item` 32.8、`.slash__row` 32.8、`.btn` 32.8、`.trigger` 26.39、`.badge` 24.39、`.seg__item` 24.39——所有带字的控件高度都是小数，根因是 13 × 1.6 = 20.8。
- **改成**：tokens.css 加 `--lh-xs: 16px` / `--lh-sm: 20px`（**不加 `--lh-base`**，14px 的控件只有侧栏 `.row`，它已靠 `--sb-row-h` 定死），14 个控件按一张对照表改 `line-height` 和少数 padding，落到 24 / 28 / 32 三档。正文（`.md` / `.msg--user`）继续走 body 的 1.6。
- **为什么**：套进 harness 重测，14 个控件全部落在 4 的倍数上；`.mentions__row` 的 padding 也要 4 → 6px 一起进 32，否则三个从输入框上边缘弹出来的面板还是两种高。
- **动哪儿**：tokens.css、app.css、items.css、popover.css、status.css、settings.css。
- **风险**：**`line-height` 必须写在该规则的 `font: inherit` 之后**（`.btn` / `.pop__item` / `.slash__row` / `.menu__item` / `.trigger` 都有），顺序反了整条白改。收益要说实话：小数在 2x 屏上是 1.6 个设备像素，仍糊但没 1x 明显——**这是 14 处编辑换「整套锐一层」，不是能一眼看出的修复**，合之前在真机 Retina 上对比一次。`.trigger` 26.39 → 24，输入区那排会比右下角 28px 的 `.send` 更矮一档（方向是对的，但出图看一眼）。

### 34. 统一自绘焦点环

- **现状**：全仓自定义焦点样式 4 处、`focus-within` 2 处、关掉 outline 2 处（app.css:272、items.css:331）。app.css:927 已经给出了形状：`.findbar__input:focus { outline: 2px solid var(--accent); outline-offset: -1px }`。
- **改成**（若要做）：`:where(button, [role="button"], a):focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }`。**用 `outline` 不用 `box-shadow`**——后者会顶掉 `.tobottom`（app.css:1110）和 `.seg__item--on`（settings.css:133）已有的 `--shadow-pop`；也不需要新加 `--ring` token 和 `color-mix` 的深浅调参。
- **为什么**：`:where()` 特异性为 0，组件类随时能盖掉；`outline` 自 Chromium 94 起跟 `border-radius`。
- **动哪儿**：app.css。
- **风险**：**这里有一条反对意见要正面回应**：这个应用**从来没有全局禁用过** Chromium 的默认焦点环（只有 `.sidebar__filter` 和 `.composer__input` 两处 `outline: 0`），而 tokens.css:10 的 `color-scheme: light dark` 让默认环自动跟深浅走——铺一条全局规则是在覆盖一个已经能用的东西，还要挨个开洞。所以这条的前提是**真机 Electron 上逐控件截图确认没有双环**，不是顺手加一行。另外 `.send` 是强调色实心圆，强调色的环压在强调色上等于没有，要单独给它 `outline-offset: 2px`；`.pop__item` 在 4px 内边距的 `.pop` 里，确认 1px offset + 2px 环没被 `overflow-y: auto` 削掉。第 15 条那一行（搜索框）不受这条阻塞，先做。

### 35. `--text-faint` 再往上推到 4.5:1

- **现状**：第 27 条落地后是 3.66:1（浅）/ 3.50:1（深）。另一套方案是三档整体压一档：浅 `#76767f`(4.50:1) / `#5c5c66`，深 `#83838f`(4.77:1)。
- **改成**：暂不改。要做就先出图。
- **为什么**：4.5 会让 `--text-muted` ↔ `--text-faint` 的 ΔL\* 从 18.7 收到 10.6，层级明显变平，而且比参照物（Linear 浅色三级文字实测约 3.2:1）更实。**3.66 是桌面应用的正常带，4.50 是网页正文的带。**
- **动哪儿**：tokens.css（73 处引用受影响，但只在浅色下）。
- **风险**：这是基调层面的选择，不是 bug 修复。要做就用 chrome-headless-shell 静态 harness 浅深各一张，重点看三处最依赖「淡」的地方：diff hunk 头（diff.css:129「压到最淡」）、crash 栈（app.css:886「压得很淡……不该吓住其他人」）、`.error--soft`（items.css:294-299）。

### 36. 浮层入场动效

- **现状**：`.pop`（popover.css:61-71）没有 animation 也没有 transition，`.mentions` / `.slash` 同样——浮层是「啪」地出现的。
- **改成**：Popover.tsx 只加一个属性 `data-placed={at !== undefined}`；`.pop[data-placed="true"] { animation: pop-in var(--dur) var(--ease) }`，`@keyframes pop-in { from { opacity: 0; transform: scale(0.98) } }`，配 reduce 块关掉。`.mentions` / `.slash` 直接挂（位置是纯 CSS 给的）。
- **为什么**：**挂在 `data-placed` 上而不是 `.pop` 上**——位置是挂载后由 `useLayoutEffect` 算出来的，那之前面板是 `visibility: hidden`。今天挂 `.pop` 碰巧不出事，但哪天有人把它改成 `useEffect`，动画就在看不见的那一帧跑完了，**而且不报错**。
- **动哪儿**：Popover.tsx、popover.css。
- **风险**：**这是全部条目里唯一不修任何缺陷的一条**，排最后做。`transform-origin` 保持默认 center：为了「从触发器那侧长出来」去改 `Placement` / `place()` / `placeAtPoint()` 不划算——那两个函数承载的是 Popover.tsx:22-23「**超出窗口要翻边**」，是这个文件里最不该为装饰性改动去碰的地方，而 3% / 130ms 根本分不出 origin 在哪个角。退场不做（`return null` 那条路要引一份「正在关闭」状态，会和 `close()` 打架）。

---

## 专节：滚动条默认隐藏、滚动才现

> **⚠️ 这一节的结论后来被实测推翻了一半，2026-08-17 已按新结论落地。**
> 下面原文保留（它记着当时为什么那么判），修正写在这里：
>
> - **第 1 条（写了规则就切经典条）成立**，所以自绘那套样式只挂在
>   `[data-bars="classic"]`——那个标记是量出来的（`useScrollbars.ts` 造探针看占不占宽）。
>   触控板档位一个字节都不生效，系统的叠加条原样留着。
> - **第 2 条（永久让出 10px）在经典条档位下反了**：系统那根实测 **17px**，
>   自绘 10px 槽 / 4px 滑块，是**省 7px**。
> - **第 3 条（滑块参与不了动画，做不出淡出）是错的。** 按本节自己开的判据跑了探针：
>   直接给 `::-webkit-scrollbar-thumb` 写动画确实不生效（红→蓝冻结在 50%，渲染出来还是纯红）；
>   但**把变量动在容器上、滑块用 `var()` 读**这条路生效（同样冻结 50%，
>   渲染结果和写死 `.5` 的对照一模一样）。淡出因此做得成。
>
> **教训**：「大概不行」和「量过不行」之间隔着一次三分钟的探针。本节当时把探针写好了却没跑。

**（以下为原结论，已部分推翻）结论：不自绘。这套行为系统已经免费给了，自绘只会把它弄丢。** 下面是完整的算账，以及真要重开这件事的先决条件。

**现状盘点**（全仓 `grep -rn 'webkit-scrollbar|scrollbar-width|scrollbar-color|overscroll'` 排除 node_modules）：**0 命中**。唯一相关声明是 app.css:500 的 `scrollbar-gutter: stable`（只在 `.sidebar__list` 上），app.css:23-32 把 `html/body/#root` 钉成 `overflow: hidden`。共 15 个滚动容器，其中包括**任何自绘方案都不能漏掉的** `.composer__input`（items.css:328-338，`max-height: 180px`）——它是唯一一个用户打字时能看着自己滚动条动的容器。

**为什么不做，三条**：

1. **macOS 上只要有任何一条命中某元素的 `::-webkit-scrollbar` 规则，Chromium 就把这个容器从 overlay 路径切到经典条路径**——常驻占据 content box 宽度，而且没有系统的淡出。标准属性 `scrollbar-width` / `scrollbar-color` 后果相同，还连伪元素都没有，做不出「藏起来」。
2. **代价是实的**：今天在 overlay 档下滚动条占 **0px**，落地后 14 个容器各永久让出约 10px。`.pop` 的内边距只有 `var(--sp-1)` 4px（popover.css:66），落地后左 4px、右 14px——一张十几行的模型清单左右不对称。这个代码库为 22px 按钮盒的 3.5px 四边对称写过整段注释（app.css:509-519），不会接受用 10px 换一个滑块颜色。
3. **淡出的机制没有验证过，而最可能的退化比现状更糙**。Blink 的 custom scrollbar part 历来不参与 transition/animation 系统；用 `@property` 驱动 `::-webkit-scrollbar-thumb` 每帧重绘是没根据的赌，退路（thumb 上直接写 transition）大概率同样不生效，结果是**瞬切**——比 macOS 原生的淡出更糙。

**要落地的产出：一段注释**，接在 app.css:23-32「窗口自己永远不滚」那段之后（那是全仓讨论滚动的唯一入口）：

```css
/* **不要自绘滚动条。** 这不是没想过，是算过账：
 *
 * macOS 上只要有**任何一条**命中某元素的 `::-webkit-scrollbar` 规则，
 * Chromium 就把这个容器从 overlay 路径切到经典条路径——**常驻占据
 * content box 宽度，而且没有系统的淡出**。标准属性 `scrollbar-width` /
 * `scrollbar-color` 后果相同，还连伪元素都没有，做不出「藏起来」。
 * 实际代价是：14 个滚动容器各永久让出约 10px（今天是 0），
 * `.pop` 会变成左 4px 右 14px，换来的只是一个滑块颜色。
 *
 * 「滚动才出现、停手约 1 秒淡出、不占宽度」这套行为，系统在触控板档位
 * 白送。插了鼠标则是经典条（macOS「自动根据鼠标或触控板」这一档），
 * 那是用户自己选的——我们要做的是让布局在两档下都成立
 *（见 `.sidebar__list` / `.transcript` 的 `scrollbar-gutter`），
 * 不是把这个选择吞掉。 */
```

**如果将来仍要重开，先决条件写死在这里**：在 `pnpm dev` 里先验一件事——`@property --thumb-alpha` 的插值能不能真的驱动 `::-webkit-scrollbar-thumb` 每帧重绘。验证草案（**只在验证期存在，验不通就整份丢掉**）：

```css
/* 验证用，不要合并。三个容器足够判定：一个长列表、一个浮层、一个 textarea */
@property --thumb-alpha { syntax: "<number>"; inherits: true; initial-value: 0; }

.transcript, .pop, .composer__input {
  transition: --thumb-alpha 400ms 900ms var(--ease);   /* 停手 900ms 后淡出 */
}
.transcript:hover, .pop:hover, .composer__input:hover { --thumb-alpha: 1; transition-delay: 0s; }

.transcript::-webkit-scrollbar,
.pop::-webkit-scrollbar,
.composer__input::-webkit-scrollbar { width: 10px; }

.transcript::-webkit-scrollbar-thumb,
.pop::-webkit-scrollbar-thumb,
.composer__input::-webkit-scrollbar-thumb {
  border: 3px solid transparent;      /* 靠透明边框做内缩，thumb 实宽 4px */
  border-radius: 999px;
  background-color: rgb(from var(--text) r g b / calc(var(--thumb-alpha) * 0.28));
  background-clip: padding-box;
}
```

```ts
/** 验证用。判据只有一条：滚动停手 900ms 后，滑块是**渐**隐还是**瞬**隐。
 *  瞬隐 = @property 驱动不了 part 重绘 = 整件事到此为止。 */
export function probeScrollFade(el: HTMLElement): void {
  el.addEventListener("scroll", () => {
    el.style.setProperty("--thumb-alpha", "1")
    el.style.transitionDelay = "0s"
    requestAnimationFrame(() => {
      el.style.removeProperty("--thumb-alpha")
      el.style.transitionDelay = ""
    })
  }, { passive: true })
}
```

判据写死：**渐隐才继续，瞬隐就停**；即使渐隐成立，也还要先回答第 2 条那 10px 怎么办（`.pop` 的 4/14 不对称、`.composer__input` 打字时的行宽变化），再决定要不要开工。以及提醒一句：真做，名单必须包含 `.composer__input`。

**眼下真正该做的替代**是第 6 条——给 `.transcript` 补 `scrollbar-gutter: stable`，让布局在经典条和 overlay 两档下都成立。那才是这件事里唯一今天就在犯的错。

---

## 查过但不做

- **自绘滚动条 / 自动淡出**：见上一节。系统在触控板档白送这套行为，自绘会把 overlay 路径整个丢掉，14 个容器各让出 10px 换一个滑块颜色。
- **给嵌套滚动块加 `overscroll-behavior: contain`**：Chromium 的 scroll latching 已经保证一次手势不会从块里漏到对话上；而 `contain` 会堵死「读完这块接着往下读」。9 个候选里有 6 个（`.pop` 是 fixed、`.slash` / `.mentions` 挂在不滚的 `.composer__inner` 里、`.crash__stack` 整屏替换）上游根本没有可滚的祖先，加了是零效果的噪声。
- **抬高 `.pop__desc` / `.set__hint` 的行距和字号**：`.pop` 只有 `min-width` 没有 `max-width`，宽度是 shrink-to-fit，`.pop__desc` **排在一行上**不折行——前提就不成立；`.set__hint` 那半边 1.5 → 1.65 每行只多 1.7px，量级等于没改。
- **`.set` 底色改 `--bg-raised`**：深色 scrim 是 60% 黑，身后已被压到 L\*≈2.49、面板 7.91，台阶 5.42 比改完（3.06）还大；tokens.css:90-95 那段注释是这件事**当初被修掉的记录**，不是病历。而 settings.css:1-7 明写「做成**居中的一块**而不是又一个浮层」。
- **加深 `--border-strong` 的值**：会连带 8 处控件轮廓（含审批卡），且深色下那条边本来就不弱（+12.5 L\*），再加重是往厚边框漂。
- **浅色 `--bg-code` 从 #f6f6f7 调到 #f4f4f6**：实测只买到 0.64 个 L\*，却要动到全部代码块和行内代码。
- **给 `.sidebar` / `.pop` / `.menu` 加局部 hover token 覆写**：侧栏 hover 的主信号是 app.css:152 那条 `color: var(--text)`（文字 ΔL\*=37.7），底色的 2.39 只是配角；覆写会落到 `.foot__act` 头上，而那颗键的形制是「比过三版、在 258px 侧栏里量出来的」。
- **去掉 `.mentions__name` 的 `flex: none`**：会让常见的长目录 + 短文件名把文件名截掉，正面推翻 app.css:1006「目录……**允许被挤掉**——找的是文件名」。用罕见 bug 换常见 bug。
- **给 `.diffstat__*` / `.pop__head-meta` 加 tabular-nums**：前者渲染出来就不再变、且和 `.step__target` 本来就不在一列上（右对齐已被 items.css:106-108 判过）；后者是块级左对齐文本，不存在「整枚居中的东西左右晃」。
- **`.seg__item:active`**：那个控件「选中 = 更亮」，给未选中项一个深色 press 是和它自己的明暗逻辑对着干。
- **`--dur-fast: 90ms` 和换缓动曲线**：前者零使用者（定一个没人用的 token 和第 1 条那批死引用是同一类错误）；后者是没有实测支撑的手感断言，而这个仓库对手感改动的标准是出图比稿。
- **缩略图占位块加骨架扫光**：200ms 就结束了，一个静态灰块够；仓库对「一刻不停的动画持续抢注意力」有明确态度。
- **冷启动 8 秒换文案 + 「重试」按钮**：两家驱动握手上限都是 20 秒且会抛，横幅会自己带着原因过来，多一层猜测只会让两句话打架。
- **给 `.blank` 加 `-webkit-app-region: drag`**：它和转录区空态共用，加了等于让转录区空白也能拖窗口，还会把里面的东西变成不可点。
- **设置面板做 sticky 头**：那是另一个决定，别顺手夹带。
- **删掉 `.sidebar__brand` 的 `letter-spacing: 0.01em`**：16px 上是 0.16px，改了看不见，纯 churn。
