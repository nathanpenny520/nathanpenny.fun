# Achievements 页面填充指南

`pages/achievements.html` 的内容由 **`data/achievements.json`** 驱动，前台由
`main.js initAchievements()` 渲染。推荐在后台 **Content → Achievements** 标签页
编辑（与 Gallery / Creations 相同：保存即提交 GitHub main，一两分钟生效），
也可以直接手改 JSON 文件推上去。

## 数据结构

顶层是**分区（section）的数组**，顺序即页面顺序；每个分区对应页面上的一个
`<section class="achv-section">`：

```json
[
  {
    "id": "publications",
    "icon": "fa-book",
    "title": "Publications",
    "items": [
      {
        "id": "first-paper",
        "title": "论文 / 项目 / 奖项名",
        "badge": "期刊 / 会议 / Award 等出处标签",
        "date": "2026-09",
        "description": "一两句话说明它是什么、为什么重要。",
        "links": [
          { "label": "Read it here", "url": "https://example.org/paper" },
          { "label": "Source code", "url": "https://github.com/you/repo" }
        ]
      }
    ]
  }
]
```

字段说明：

- `id`（分区和条目都要）— 小写 slug（`^[a-z0-9][a-z0-9-]{0,63}$`），分区 id
  同时是页面锚点。
- `title` — 必填；分区标题 / 成就名称。
- `icon` — 分区图标，Font Awesome 免费版名字（自托管 6.5.2，`fa-solid`）：
  `fa-book`、`fa-diagram-project`、`fa-trophy`、`fa-certificate`、
  `fa-person-chalkboard`、`fa-flask`… 留空时按分区 id 自动挑默认图标
  （publications / projects / awards / certificates / talks / research 有内置
  映射，其余用 `fa-star`）。
- `badge` — 元信息行的小圆角标签（期刊名、"Side project"、"Award"…），可省略。
- `date` — `YYYY-MM` 或 `YYYY-MM-DD`，页面显示成 "Sep 2026"，可省略。
- `description` — 可选描述段。
- `links` — 可选，最多 6 条，必须是 `http(s)` 绝对地址；GitHub 链接自动用
  GitHub 图标，其余用外跳图标，一律新窗口打开。

文件为 `[]`（或分区全部删空）时，页面显示内置的 "nothing here yet" 空状态。

## 后台校验规则（editor.js `validateAchv()`）

id 必须是小写 slug；title ≤ 80（分区）/ 200（条目）；badge ≤ 120；
description ≤ 1000；date 必须匹配 `YYYY-MM` 或 `YYYY-MM-DD`；links ≤ 6 且
label ≤ 80、url 必须绝对地址；分区 ≤ 20、每区条目 ≤ 100。不满足会直接报
400（带条目序号），不会把坏数据推上 GitHub。

## 手动发布步骤（不经后台）

1. 编辑 `data/achievements.json`（合法 JSON，注意逗号；推荐用后台改，免手写）。
2. 本地预览：`python3 -m http.server 8080` →
   `http://localhost:8080/achievements`，顺手检查深色模式。
3. `git push origin main` 即部署；`data/achievements.json` 在 sw.js 预缓存
   列表里，离线也可用。

## 历史备注

旧版页面是手写 HTML 卡片（模板注释可在 git 历史找回），2026-09 改为 JSON
驱动；`/games → /achievements` 的 301 仍保留在 `_redirects`。
