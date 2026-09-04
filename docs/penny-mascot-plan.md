# Penny 吉祥物 · 无缝融入 nathanpenny.fun 方案（评审修订版）

> 状态：**已实施（2026-09-04）**——素材（`web/` 12 张）与 P0/P1 融入点（404、评论区加载/空/成功三态、Toast 头像、Hero 剪影）已落地；§5.6 / §5.7 / §5.8（P2）按方案搁置，§5.9 已砍掉。
> 角色：**Penny** — 蓝紫星灵猫，星之守护者（Star Guardian），口头禅 "Stay curious!"
> 依据：原始方案 + 一次代码级评审（各挂载点已对照 `404.html` / `contact.html` / `index.html` / `main.js` / `style.css` / `tools/gen_post_pages.py` 逐行核实）

---

## 0. 为什么能"无缝"

Penny 与网站天然同源：

- **主题同频**：网站暗色模式自带全屏星空（`#starField`）、UFO 彩蛋、404 页 "Beamed up!"（被 UFO 接走）——Penny 是"星灵猫"，**星空/太空主题完全一致**，不是外挂吉祥物，而是"本来就是星空居民"。
- **配色同源**：网站强调色为 teal 青绿（`--color-accent: #1abc9c`）+ 紫（`--hero-title-c: #6a5cff`），与 Penny 的蓝紫青配色属于同一色系；亮/暗两套主题下都能自然融合。
- **符号呼应**：Penny 的硬币吊坠 = 名字词源（Penny 便士），N 浮雕 + N 形呆毛 = Nathan 首字母，头顶与尾巴的星星 = 网站星空元素。

---

## 1. 无缝融入的四个原则

1. **克制的点缀**：Penny 是"彩蛋/陪伴者"，不是页面主角——只在有故事的地方（404、空状态）担任主角，其余位置做小尺寸点缀，绝不抢内容主体。
2. **复用现有机制**：所有融入点都挂在网站已有的容器/组件上（`#commentList`、toast、UFO 彩蛋、starField、scroll-reveal），不新增独立模块、不改变现有架构。
3. **轻量动效**：只用 CSS 动画（浮动、呼吸、淡入）实现"活着"的感觉，不引入复杂 JS/Canvas 重绘。
4. **双主题适配**：亮色/暗色（含 `data-theme` 手动切换）都要协调，通过现有 CSS 变量取色，**不为 Penny 引入任何新色值**。

---

## 2. 配色映射（Penny 品牌色 → 网站 CSS 变量）

| Penny 色 | 色值 | 网站对应 |
|---|---|---|
| 深海军蓝 | `#0f3891` | 暗色主题星空底、nav 深色块（`--color-nav-bg` 暗色 #10161c 邻近） |
| 紫罗兰 | `#8d6dc7` | 网站紫 `--hero-title-c`、`--aurora-violet` |
| 青 | `#10b9db` | 网站青绿 `--color-accent`、`--aurora-blue`、UFO 光效 `#7ef4d6` |
| 淡紫 | lavender | 浅色主题卡片底、hover 高亮 |
| 古铜金 | copper | 仅作点缀（硬币吊坠），不超过整体面积 5% |

> 原则：Penny 主色落在网站的"紫—青"区间，深蓝负责暗部，古铜金只出现在硬币细节，避免引入新色系。

---

## 3. 融入点位总览（评审核实后）

| # | 页面 / 位置 | 挂载点（已核实存在） | 形态 | 优先级（评审后） |
|---|---|---|---|---|
| 1 | 404 页 | `.error-page`（`404.html`） | 被 UFO 光束照住的插画 + CSS 浮动/光束呼吸 | **P0** |
| 2 | 评论区·空状态 | `#commentList` + `loadComments()`（`main.js`） | 抱星星坐姿 + "No comments yet" | **P0** |
| 3 | 评论区·加载中 | `contact.html` 静态 `.comment-loading` | 睡觉/等待小图 | **P0** |
| 4 | 评论区·提交成功 | `#commentStatus`（`contact.html`） | 开心表情（HAPPY） | P1 |
| 5 | Toast 提示 | toast 组件（`main.js` `showToast`） | 小头像置入图标位（**需改函数签名**） | P1 |
| 6 | 首页 Hero | `.hero-stage`（`index.html`） | 右下角坐姿小剪影（**仅暗色+桌面，降半级**） | P1（缩水） |
| 7 | About 页 AI 伙伴 | 全站浮窗 `initSiteChat`（`main.js`） | AI 助手打开时浮现（**需先决策范围**） | P2 |
| 8 | 阅读进度条 | progress bar（`main.js`） | 进度条顶端星星尾巴小图标 | P2 |
| 9 | UFO 抓 Penny | starField UFO 逻辑（`main.js` canvas 内绘制） | canvas `ctx.drawImage()` 绘制（**正确路线**） | P2（可搁置） |
| ~~10~~ | ~~Footer / Logo 旁~~ | ~~8 页手工复制 + 生成器模板~~ | **砍掉**（维护代价 > 收益） | ❌ |

---

## 4. 素材（真正的第一优先 · 已完成）

**评审结论**：素材是比任何点位都优先的阻塞点。原 8/9 张为"JPG 带背景直接转存 .png"（无透明通道），`core-penny.png` 单张 4.8MB，二者都无法直接上页面（站点其他图片为几十 KB 级）。**第一步必须是：抠透明底 → 裁切表情/动作拼图 → 压缩到每张 <100KB。** 以下为已完成的素材工程：

### 4.1 目录结构

```
images/assets/mascot/
├─ *.png                    # 9 张设计稿（设定卡/三视图/表情/色卡/动作/海报/融入效果图）
├─ core-penny.png           # 核心形象透明底（RGBA 2048×2048，源文件）
├─ singles/                 # 裁切后的 10 张单格（带背景，源）
├─ transparent/             # 10 张单格透明底 PNG（高质量源，可再压缩/放大）
└─ web/                     # 网页用素材（WebP 透明底，全部 <100KB）★ 工程师取用此目录
```

### 4.2 素材清单（web/ 目录）

| 文件 | 内容 | 尺寸 | 体积 |
|---|---|---|---|
| `core-penny-512.webp` | 主形象（头像/图标） | 512×512 | 30 KB |
| `core-penny-1024.webp` | 主形象（404/大图） | 1024×1024 | 90 KB |
| `expr-happy.webp` | 表情 HAPPY | 870×805 | 77 KB |
| `expr-surprised.webp` | 表情 SURPRISED | 875×805 | 92 KB |
| `expr-sleepy.webp` | 表情 SLEEPY | 870×810 | 84 KB |
| `expr-excited.webp` | 表情 EXCITED | 875×810 | 95 KB |
| `act-waving.webp` | 动作 挥手 | 580×443 | 24 KB |
| `act-coding.webp` | 动作 写码 | 590×443 | 47 KB |
| `act-jumping.webp` | 动作 跳跃 | 595×443 | 35 KB |
| `act-reading.webp` | 动作 读书 | 580×445 | 34 KB |
| `act-hugging.webp` | 动作 抱星 | 590×445 | 33 KB |
| `act-sleepy.webp` | 动作 睡觉 | 595×445 | 22 KB |

- 全部为**透明底 WebP**（RGBA，支持 alpha），经双主题（暗 `#171d24` / 亮 `#f5f7fa`）合成验证：无白边、无残留。
- 动作页 WAVING/CODING/JUMPING/READING/HUGGING/SLEEPY 六宫格、表情页 2×2 四宫格已**逐格精确裁切**（按米白十字空隙检测边界），非整图直接使用。
- 源 PNG 保留在 `transparent/`（1MB 级）与 `singles/`，如需更大尺寸或换格式可再加工。

---

## 5. 各点位详细方案（含评审核实结论）

### 5.1 P0 — 404 页（UFO 光束版）✅ 完全成立

**现状（已核实）**：`404.html` 的 `error-code`（"4🛸4"）+ "Beamed up!" 结构在 `#L58-L59`，两者之间插图 + 两个 CSS keyframe 是十行以内的 diff；样式加进 `style.css` 的 `404 PAGE` 区即可。

**方案**：在 `error-code` 与标题之间插入 `core-penny-1024.webp`（被光束照住的插画），配两个 CSS 动效：
- 光束：轻微呼吸闪烁（`opacity` 1→0.85 循环，2.5s）；
- Penny：上下轻微浮动（`translateY` ±4px，3s 缓动）。
沿用现有 UFO 叙事，文案不用改。

**双主题**：暗色下直接用深色星空底（最协调）；亮色下给插画一个浅色圆角底卡，保证可读。

### 5.2 P0 — 评论区空状态 + 加载中 ✅ 完全成立（比原方案还简单）

**现状（已核实）**：空状态是 `main.js` `loadComments()` 的**一个分支**（`.comment-empty`，`#L830`）；加载态是 `contact.html` 的**静态 HTML**（`.comment-loading`，`#L212`）；CSS 三态共用一段（`style.css` `#L2615-L2622`）。评论区只存在于 contact 一个页面，**没有手工复制同步问题**。注入静态 `<img>` 不涉及用户输入，不违反 `escapeHtml` 规约。

**方案**：
- 空状态：`expr-happy.webp` 或抱星动作 + 现有空状态文案（仅替换视觉）。
- 加载中：`act-sleepy.webp` 打盹小图 + 同文案。

### 5.3 P1 — 提交成功表情 ✅ 可落地

**现状（已核实）**：`#commentStatus` 在 `contact.html` `#L204`。在成功分支旁加一张 HAPPY 小图（`expr-happy.webp`），顺手就能做。

### 5.4 P1 — Toast 头像 ⚠️ 需改函数签名

**现状（已核实）**：现有 toast **没有图标位**——`main.js` `showToast(message)`（`#L2039-L2050`）是纯 `textContent`。

**方案**：改函数签名或补可选图片参数（如 `showToast(message, {icon})`），图标位放 `core-penny-512.webp` 小头像。改动本身仍很小，只是原方案低估了"需要动签名"这一点。

### 5.5 P1 — 首页 Hero 剪影 ⚠️ 建议降半级

**现状（已核实）**：hero 结构存在（`index.html` `#L65` hero-stage），定位 + `data-reveal` 可行。但两个顾虑：
1. hero 是首屏，放吉祥物与原则 1"不抢内容主体"打架；90–120px 在移动端会挤（底部已有 scroll-cue）；
2. `[data-reveal]` 是滚动显现，首屏元素会立即触发，动效意义不大。

**结论**：降半级——**仅暗色主题 + 桌面端**出现，移动端与亮色隐藏；或用极淡的 opacity 常驻而非 reveal 动效。

### 5.6 P2 — About 页 AI 伙伴 ⚠️ 需先决策

**现状（已核实）**：`initSiteChat` 是**每个页面都有的全局浮窗**（`main.js`），不是 About 专属。方案"About 页打开 AI 助手时浮现"需要二选一：
- **全站生效**：与"克制"原则冲突；
- **仅 About**：需要专门加 About 判断。

**结论**：先做决策（全站 vs About 专属）再动手；决策前不实施。`#aboutAvatar` 保持本人照片不替换。

### 5.7 P2 — UFO 抓 Penny ⚠️ 实现路线更正

**现状（已核实）**：UFO、光束、火花全是 **canvas 内绘制**（`main.js` `skyUpdateUfo` 的 caught 模式，`#L1383-L1480`）。原方案"用 DOM 图片 + 已有动画节奏"需 DOM overlay 叠在 `pointer-events:none` 的固定 canvas 上，要处理坐标换算和滚动，反而复杂。

**结论**：正确路线是 `ctx.drawImage()` 把透明 PNG 直接画进 canvas。即便如此，它也是所有点位里**唯一要动 rAF 主循环逻辑**的，作为 P2 排最后，**可无限期搁置**。

### 5.8 P2 — 进度条星星 维持 P2

**现状（已核实）**：可行但琐碎（星星要跟随滚动同步定位），价值/成本比一般，维持 P2 即可。

### 5.9 ❌ 砍掉 — Footer 点缀

**现状（已核实）**：footer 在 8 个页面 + 404 里是**手工复制**的，且博客单篇页由 `tools/gen_post_pages.py` 模板生成——改 footer 意味着手工同步 10+ 处再改生成器模板，否则下次 CI 重新生成就出现不一致。为极小图标付出这个维护代价不值，**建议砍掉**。

---

## 6. 横向工程注意点（原方案未提）

1. **sw.js 预缓存**：新增图片资源要加进 `sw.js` 预缓存清单并 bump `CACHE_VERSION`（当前 v24），否则老用户拿不到新图。
2. **动画可访问性**：新增的浮动/呼吸 keyframe 应沿用站内惯例，尊重 `prefers-reduced-motion`。
3. **双暗色块同步**：`style.css` 的暗色变量在 `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` 与 `:root[data-theme="dark"]` 两处同步；本项目只取现有 CSS 变量、不为 Penny 引入新色，该约定务必坚持。
4. **自托管**：外链素材（`doubaocdn.com`）只是设计过程稿，正式资产必须进仓库自托管（站点无外链 CDN 的既定原则）；`images/assets/mascot/` 已按此落地，方向正确。

---

## 7. 优先级与落地顺序（评审重排后）

1. ~~素材透明化~~ → **已完成**（见 §4）
2. **P0 · 单文件小 diff**：404 页 → 评论空状态/加载中 → 提交成功表情
3. **P1 · 增强**：Toast（改签名）→ Hero（仅暗色+桌面，再评估）
4. **P2 · 其余全部搁置**：About（先决策）→ 进度条星星 → UFO（canvas 路线，可无限搁置）
5. **砍掉**：Footer 点缀

> 前 4 步都是单文件小 diff、互不依赖、可独立回滚；不涉及架构变更，也不新增第三方依赖。

---

## 8. 边界声明

- 本轮**仅交付设计方案、视觉效果图与网页素材，未修改 `nathanpenny.fun` 的任何 `.html/.css/.js` 代码**。
- 素材已备齐（`images/assets/mascot/web/` 12 张 WebP + `transparent/` 源 PNG），代码集成由工程师按 §5/§6 落地。
