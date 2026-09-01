# Achievements 页面填充指南

`pages/achievements.html` 是用来展示个人成就的页面(出版物、项目、获奖等)。
页面目前是**故意留空**的:访客只会看到一个"nothing here yet"的空状态卡片。
等第一条成就落地后,按本文档操作即可。

## 涉及的文件

| 文件 | 作用 |
|------|------|
| `pages/achievements.html` | 页面本体,所有成就都写在这里(无模板系统,直接写 HTML) |
| `styles/style.css` | 文件末尾的 `ACHIEVEMENTS PAGE` 段落,所有 `.achv-*` 样式已就绪 |
| `_redirects` | 友好 URL:`/achievements` → `pages/achievements.html`;旧 `/games` 已 301 到 `/achievements` |
| `sitemap.xml` | 由 `tools/gen_post_pages.py` 重新生成,不要手改 |
| `sw.js` | `pages/achievements.html` 已在预缓存列表里,平时不用动 |

## 第一步:从"空状态"切换到正式结构

打开 `pages/achievements.html`,`<main>` 里有两块内容:

1. 一个 `<div class="achv-empty">…</div>` —— 空状态提示,**删掉它**;
2. 一大段被 `<!-- -->` 注释掉的 `<div class="achv-wrap">…</div>` 模板 ——
   **取消注释**(删掉包裹它的 `<!--` 和 `-->` 两行),里面已经带了一个
   Publications section 和一个 Projects section 的示例卡片。

然后把示例卡片换成真实内容即可。

## 每条成就 = 一个 `.achv-card`

```html
<article class="achv-card">
  <h3>标题(论文题目 / 项目名 / 奖项名)</h3>
  <p class="achv-meta">
    <span class="achv-badge">出处 / 类型标签</span>
    <time datetime="2026-09">Sep 2026</time>
  </p>
  <p class="achv-desc">一两句话说明它是什么、为什么重要。</p>
  <p class="achv-links">
    <a href="https://example.org/paper" target="_blank" rel="noopener">Read it here <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
  </p>
</article>
```

字段说明:

- `h3` — 成就名称。
- `.achv-meta` — 元信息行:`.achv-badge` 是一个小圆角标签(期刊/会议名、
  "Side project"、"Award" 之类的分类),`<time>` 是时间;两者都可以省略,
  不需要就整行删掉。
- `.achv-desc` — 可选的描述段。
- `.achv-links` — 可选的链接行,多个链接用 `&middot;` 分隔。
  外链一律加 `target="_blank" rel="noopener"`;
  GitHub 链接的图标用 `fa-brands fa-github`,普通外链用
  `fa-solid fa-arrow-up-right-from-square`。
- 同一分类下新成就在上、旧成就往下排。
- 内容全是自己手写的静态 HTML,不需要转义;直接从 Word/PDF 复制时注意
  把智能引号、不可见字符清理掉。

## 分类(section)管理

一个分类 = 一个 `<section class="achv-section" id="…">`,标题里的图标用的是
自托管的 Font Awesome 6.5.2(`fa-solid` 免费图标都可用):

```html
<section class="achv-section" id="awards">
  <h2><i class="fa-solid fa-trophy" aria-hidden="true"></i> Awards</h2>
  <div class="achv-list">
    <!-- .achv-card 若干 -->
  </div>
</section>
```

现成的两个分类:`#publications`(图标 `fa-book`)、`#projects`(图标
`fa-diagram-project`)。想加别的,常用图标还有 `fa-trophy`(奖项)、
`fa-certificate`(证书)、`fa-person-chalkboard`(演讲)、`fa-flask`(科研)。
**注意**:`id` 不要和站内已有锚点冲突;改了分类记得连 `<section id>` 一起改。

某个分类暂时没有内容时,直接把整个 `<section>` 注释或删掉,不要留空的
`.achv-list`。

## 发布步骤

1. 编辑 `pages/achievements.html`(纯 HTML 改动,不涉及任何 JS)。
2. 本地预览:`python3 -m http.server 8080`,访问
   `http://localhost:8080/achievements`,顺手检查一下深色模式。
3. (可选)跑一次 `python3 tools/gen_post_pages.py` —— 它会重建
   `sitemap.xml`,把静态页的 `lastmod` 刷成当天。不跑也不影响页面工作。
4. `git push origin main` 即部署(Cloudflare Pages 拉取后自动生效)。

**什么时候需要动 `sw.js`**:只有当这条成就带来了新的静态资源(比如封面图、
PDF 原文)且希望离线可用时,才把资源加进 `PRECACHE` 并把 `CACHE_VERSION`
`+1`(如 `v6` → `v7`)。只改 HTML 不需要 —— 页面本身是网络优先的。

## 关于旧的 /games

games 页面(UFO Battle)已整体移除,代码在 git 历史里随时可以找回。
`_redirects` 里保留了 `/games → /achievements` 的 301,避免老链接 404;
不想要的话删掉 `_redirects` 最后一行即可。
