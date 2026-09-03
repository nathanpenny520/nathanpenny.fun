# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A hand-rolled static personal website + blog (`nathanpenny.fun`) with no build step, no package.json, and no framework. Frontend is plain HTML/CSS/vanilla JS; the only backend is a Cloudflare Worker (`workers/comments.js`) backed by a Cloudflare D1 SQLite database for the comments. All site text/content is authored directly in the HTML files.

## Commands

There is no build, lint, or test tooling — nothing to install.

- **Preview locally**: serve the repo root with any static file server, e.g. `python -m http.server 8080` (port 8080 is the dev origin allowed by the Worker's CORS list, so the visitor/comment features work locally too).
- **Publish a post online (写作台)**: `https://workers.nathanpenny.fun/admin` (Cloudflare Access) → 写作台 tab → write → 发布 — the Worker commits `posts/<slug>.md` to main via the GitHub Contents API and CI regenerates the pages (~1 min). Also handles opening/editing/deleting existing posts; frontmatter is validated against the generator's rules before publishing.
- **Upload images for posts**: `https://workers.nathanpenny.fun/admin` (Cloudflare Access email OTP) → drag/paste → copy the markdown snippet → paste into the `.md` (remote URLs automatically get the `blog-img` class in the generator); the 写作台 tab can also upload + insert image markdown directly.
- **Issue an AI API key**: `python3 tools/ai_key.py <name> [monthly_limit]`, then apply the printed SQL via `npx wrangler d1 execute nathanpenny --remote --command "<sql>"`.
- **Regenerate blog post pages**: `python3 tools/gen_post_pages.py` (see Blog content below).
- **Regenerate the music library catalog**: `python3 tools/gen_music_library.py` (see Creations data below).
- **Deploy the site**: `git push origin main` — the host (GitHub Pages and/or the main domain) picks up the pushed files. Images, HTML, CSS, and JSON are pushed as-is.
- **Deploy the Worker**: `cd workers && npx wrangler deploy` (config in `workers/wrangler.jsonc`, see `workers/README.md`); it is NOT part of the git-deployed static site.

## Architecture

### Static pages

Seven pages share an identical, hand-copied `nav` + `footer` block (there is no templating):

- `index.html` — home
- `pages/about.html` — profile and CV download
- `pages/blog.html` — single-column post list: heading, search bar (`#blogSearch`, with clear button + match-count line), then one summary card per post (no sidebar; the sticky-sidebar TOC lives only on the single-post pages)
- `pages/gallery.html` — image grid + lightbox
- `pages/creations.html` — featured songs/videos + a searchable music library with a bottom audio mini-player
- `pages/achievements.html` — the achievements page (publications, projects, etc.; intentionally empty for now — see `docs/achievements.md` for how to fill it in)
- `pages/contact.html` — social links, comment form

Because pages live one level deep, **paths inside `pages/*.html` use `../` prefixes** for CSS, JS, images, and logo; `index.html` uses plain `./`. When adding a new page, copy the nav/footer from an existing page and fix the `../` prefixes.

Friendly URLs (`/about`, `/blog`, ...) are mapped to the `pages/` files by `_redirects`. `404.html` (UFO-themed) is served with HTTP 404 for any URL matching no real asset — it uses root-absolute asset paths because it renders at arbitrary depths.

### PWA

`manifest.json` + `sw.js` (service worker) + `images/icon-{180,192,512}.png` make the site installable and available offline. `sw.js` precaches the site shell and serves pages network-first (so deploys show up) and static assets cache-first. Bump `CACHE_VERSION` in `sw.js` when a deploy changes cached assets in a way users must see immediately.

### Stylesheets

`styles/style.css` is the site's own stylesheet, organized top-to-bottom by page into sections marked with banner comments: `GLOBAL BASICS & RESETS`, `LAYOUT`, `HEADER & NAVIGATION`, `ABOUT PAGE`, `BLOG PAGE`, `GALLERY PAGE`, `CREATIONS PAGE`, `CONTACT PAGE`, `COMMENTS`, `FOOTER`, `WIDGETS: PROGRESS BAR, BACK TO TOP, UFO EASTER EGG, TOAST`, `404 PAGE`, `ACHIEVEMENTS PAGE`. All colors are CSS custom properties defined in `:root`; the dark palette lives in TWO sync'd blocks — `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` (auto) and `:root[data-theme="dark"]` (manual toggle) — keep them in sync when changing colors. Add new styles under the matching section banner rather than at the end of the file.

The only other stylesheet is the vendored `fonts/fontawesome/css/all.min.css` (self-hosted Font Awesome 6.5.2, see Other notes).

### Scripts

`scripts/main.js` is loaded with `defer` on every page. It handles GA4, the home latest-posts cards (rendered from `feed.xml` into `#latestPostsSection`), blog list search/filtering, gallery + lightbox, creations (featured cards, music library, bottom audio mini-player), comments, the WeChat QR modal, the theme toggle (light/dark/system, persisted in `localStorage`), blog reading extras (progress bar, reading time, back-to-top), the site AI avatar chat (`initSiteChat`: floating avatar button with an "AI" badge + `<dialog>` panel on every page, also bound to the About-page portrait — talks to `/api/site-chat`, no key client-side), the home starfield (full-page dark-mode canvas: twinkling stars, meteors, the occasional rock that hits the page — `#starField` + `skyBuildStars`/`skyDrawFrame`/`initStarField`, dark-mode only via CSS opacity), scroll reveal (`[data-reveal]`), the UFO easter egg, code-block syntax highlighting on single-post pages (`initCodeHighlight`: lazily injects the vendored highlight.js only when `language-` fences exist), and service-worker registration. Each page's `<head>` also contains a tiny inline script that applies the saved theme before first paint to avoid a flash — update it in all of them (they are hand-copied) if the `theme` storage key changes. Key patterns:

- Everything is initialized in the `DOMContentLoaded` listener at the bottom.
- Each feature is guarded by `document.getElementById(...)` null-checks, so the one shared script can run on every page without erroring where a feature doesn't exist. Match this pattern for new features.
- All user-provided content (names, emails, comment text) is passed through the local `escapeHtml()` helper before being injected into `innerHTML` — never render user input unescaped.

### Gallery data

`data/gallery.json` is the source of truth for the gallery page (it is fetched at runtime via `fetch('../data/gallery.json')`). To add an image: drop the file in `images/` (blog images conventionally live under `images/blog-img/<date>/`), then add a JSON entry with `id`, `src`, `title`, `description`, `category`, `date`. Categories are auto-derived from the data to build the filter buttons.

### Creations data

`pages/creations.html` is driven by two JSON files fetched at runtime, and is deliberately independent of the blog (no cross-links). `data/creations.json` (hand-maintained) holds the featured items: `{id, type: song|video, origin: original|favorite, title, description, src, poster, cover, date}` — paths relative to `pages/`; `origin` is recorded but not rendered. `data/music-library.json` is GENERATED by `tools/gen_music_library.py` from the local, gitignored `audio/my-music/` library (`Artist/Album/Title-Album-Artist.ext` layout; cover art is downloaded into `images/music-covers/`). The audio files themselves are NOT in the repo: upload them to the R2 bucket `nathanpenny-fun` behind `storage.nathanpenny.fun` via `tools/upload_music_r2.sh nathanpenny-fun` (keys under `music/`). CI never regenerates the library JSON — run the script locally when the library changes.

### Blog content

Each post lives in `posts/<slug>.md`: frontmatter (`title`, `date: YYYY-MM-DD`, optional `description` — falls back to the first paragraph, `category` — one of the fixed slugs in the generator's `CATEGORIES` dict, defaults to `misc`, and `tags` — comma separated) plus a Markdown body. The generator's stdlib renderer supports headings (`#`–`####`, rendered one level deeper), bold/italic/strikethrough, inline code, links, autolinks, images (plain markdown images get the `blog-img` class), fenced code blocks with a language tag (`<pre><code class="language-…">`, highlighted client-side), blockquotes, hr, ordered/unordered/nested lists, task lists (`- [ ]`), and pipe tables with `:---` alignment. Raw HTML blocks pass through untouched (video/audio embeds, tables, images with explicit width/height); not supported: footnotes, math, loose (blank-line-separated) lists, multi-line list items. Asset paths are relative to `pages/` (`../images/...`) and are pushed one level deeper automatically for the single-post pages.

Publishing = edit/create the `.md` and push: CI (`.github/workflows/gen-posts.yml`) runs the generator and commits the results back to main. Running `python3 tools/gen_post_pages.py` locally does the same. Publishing is also possible from the browser via the Worker's 写作台 (see Backend below), which commits the `.md` for you. The generator (stdlib-only, idempotent) regenerates, newest post first everywhere: the category filter chips and the `<article>` cards in `pages/blog.html` between the `posts:filters` / `posts:articles` marker pairs (everything else in that file is hand-maintained — don't edit inside the markers), the single-post pages `blog/<slug>/index.html` (canonical URL, article og tags, BlogPosting JSON-LD, category badge, sidebar with the all-posts TOC, newer/older nav), `feed.xml`, and `sitemap.xml`; it also prunes `blog/<slug>/` dirs whose post no longer exists.

## Backend (Cloudflare Worker)

`workers/comments.js` (with imported modules `workers/access.js`, `workers/admin_page.js`, `workers/editor_page.js`, `workers/editor.js` and `workers/ai_proxy.js`) is a Cloudflare Worker module using a D1 binding `env.DB` and an R2 binding `env.R2` (bucket `nathanpenny-fun`). Endpoints (full details in `workers/README.md`):

| Method | Path                           | Protection        | Purpose                                       |
|--------|--------------------------------|-------------------|-----------------------------------------------|
| GET    | `/comments`                    | public            | List comments, `email` excluded from results  |
| POST   | `/comments`                    | public            | Insert a comment — 5 attempts/60s per IP via the `comment_rate` D1 table (checked first, see `checkRateLimit()`), then server-side Turnstile verification (`TURNSTILE_SECRET` secret) |
| GET    | `/admin`                       | Cloudflare Access | Admin page with three tabs: Images (file explorer) + Editor (写作台) + AI playground; UI is English-only |
| POST   | `/upload`                      | Cloudflare Access | Multipart images → R2 `img/YYYY/MM/<slug>-<6hex>.<ext>` (optional `dir` field uploads into a chosen folder); extension allowlist + 25MB cap + magic-byte sniff; objects carry `Cache-Control: public, max-age=31536000, immutable` |
| GET    | `/upload?list=1`               | Cloudflare Access | Recent uploads, newest first; `&prefix=img/…/&delimiter=1` lists one folder level → `{folders[], objects[]}` |
| DELETE | `/upload?key=img/…`            | Cloudflare Access | Delete one object (`img/` prefix only)        |
| POST   | `/upload/folder`               | Cloudflare Access | Create a folder `{path}` — R2 folders are key prefixes, so this writes a `.keep` marker (listings hide it) |
| DELETE | `/upload/folder?key=img/…/`    | Cloudflare Access | Delete a folder + everything under it (cursor list, batched delete) |
| POST   | `/upload/move`                 | Cloudflare Access | Move/rename a file or folder `{from, to}` (R2 has no native move: get+put+delete per object) |
| GET    | `/admin/api/posts`             | Cloudflare Access | List `posts/*.md` from GitHub (editor.js)     |
| GET    | `/admin/api/post?slug=…`       | Cloudflare Access | Read one post (UTF-8 + blob sha)              |
| POST   | `/admin/api/post`              | Cloudflare Access | Publish (create/update) `posts/<slug>.md` via the GitHub Contents API → CI regenerates; accepts `{slug, meta, body}` (frontmatter composed server-side, canonical key order) or a full legacy `content` string; validated like the generator (title/date/category/BOM/256KB, slug `^[a-z0-9][a-z0-9-]{0,63}$`) |
| DELETE | `/admin/api/post?slug=…&sha=…` | Cloudflare Access | Delete a post (the generator prunes its `blog/<slug>/` page) |
| POST   | `/api/ai/v1/chat/completions`  | Bearer API key    | OpenAI-compatible AI proxy (SSE streaming pass-through) |
| GET    | `/api/ai/v1/models`            | Bearer API key    | Model catalog (the free Workers AI `cf-*` models) |
| POST   | `/api/site-chat`               | public, per-IP limited | Site avatar chat used by the floating AI chat widget (no key; internal `site-avatar` api_keys row pays the quota) |

**Markdown editor (写作台)**: a two-pane tab — post list (+ New, slug filter) pinned left, and on the right a metadata form (title/slug/date/category/tags/description) above the markdown body and a live-preview pane (a JS port of the generator's renderer; the CI page stays the truth). The body textarea holds markdown ONLY; the form fields are composed into canonical frontmatter server-side (`composePost()` in editor.js), which also makes Import (.md file picker or drop) trivial — frontmatter is parsed into the form, the body into the textarea. Below ~900px the list becomes a drawer. Publishing = 发布 → the Worker commits the `.md` to main with a fine-grained GitHub PAT (`GITHUB_TOKEN` secret; repo `nathanpenny520/nathanpenny.fun`, Contents: Read and write) → `gen-posts.yml` regenerates. Updates carry the blob sha (409 → reload); a successful publish returns the new sha. The endpoints live under `/admin/api/*` so the edge Access app's path-prefix coverage injects the JWT (verified again in code); they emit no CORS headers and require `Content-Type: application/json` (CSRF line). The token never reaches the page or logs.

**Image explorer (图床)**: the Images tab is a file-explorer view over R2's `img/` prefix — breadcrumb navigation, folder cards (`.keep`-marked prefixes) + lazy thumbnails, sort, new/rename/delete folder, per-file detail dialog (copy URL/Markdown, rename, move, delete), a flat "Recent" view, and drag/drop/paste upload into the folder being viewed (root keeps the `img/YYYY/MM/` convention). Folder names are ASCII slug segments only (`normalizeFolderPath`) — dots are banned outright, same WAF `...` lesson as the upload slugify.

**Image hosting**: uploads land in the shared R2 bucket and are read via the bucket's public custom domain `storage.nathanpenny.fun` — the Worker is write-only. Slugs strip dots, structurally avoiding the WAF `...` 403 rule (same lesson as `tools/upload_music_r2.sh`). Access = Zero Trust dashboard app on `workers.nathanpenny.fun/admin` + `/upload` (email OTP, team `square-surf-c2a6`); the Worker additionally verifies the `Cf-Access-Jwt-Assertion` JWT (closes the `*.workers.dev` bypass; `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` vars; fail-closed). Local dev bypass: gitignored `workers/.dev.vars` with `ADMIN_BYPASS=1` — never deploy with it.

**AI proxy**: the single upstream is **Cloudflare Workers AI** via its OpenAI-compatible REST route (`CF_AI_TOKEN` secret + `CF_ACCOUNT_ID` var; free **10,000 Neurons/day**, no third-party keys). Models are addressed as `cf-{author}/{model}` and rewritten to `@cf/{author}/{model}` — the catalog array in ai_proxy.js is cosmetic, any model string passes through (free-tier models only; `kimi-k2.6`/`glm-5.2` etc. require Workers Paid). Third-party upstreams (OpenAI/Anthropic/Google/xAI/DeepSeek) and the AI-Gateway fronting were removed 2026-09 — an AI Gateway live-test had shown it does not bypass OpenAI's geo-block. Keys are `npai_…` generated by `python3 tools/ai_key.py <name> [monthly_limit]` — only the SHA-256 hash is stored in `api_keys`. Monthly request-count breaker lives in `ai_usage` (atomic conditional upsert, 429 when exhausted, fail-open on D1 trouble) which also accumulates token totals; per-call metadata (never prompt/response content) goes to `ai_logs` — for streamed calls the log is written by the TransformStream pump BEFORE the client stream closes, because waitUntil D1 writes issued after a streamed response silently never land (see ai_proxy.js pumpStream). CORS is `*` for `/api/ai` (bearer auth, no cookies). A daily Cron trigger (03:17 UTC) prunes `ai_logs` (>90d), `ai_usage` (>13mo), `comment_rate` and `chat_rate` (>1d). The public `POST /api/site-chat` (used by the floating avatar chat on the site) reuses the same quota/logging through an internal `api_keys` row named `site-avatar` (disable that key to turn the widget off), with its own `chat_rate` per-IP limiter (3 msgs/60s). New comments fire a fire-and-forget owner email via the `NOTIFY` send_email binding when it is configured in wrangler.jsonc (currently not configured — the code is dormant without it).

Any other path returns 404. Schema: all five tables (`comments`, `comment_rate`, `api_keys`, `ai_usage`, `ai_logs`) are in the idempotent `workers/schema.sql` (apply with `npx wrangler d1 execute nathanpenny --remote --file workers/schema.sql`; the two comment tables were created manually 2026-07 and their DDL was dumped verbatim from prod into the file later). The frontend talks to the worker at `https://workers.nathanpenny.fun` (`API_URL` in `main.js`), and to `.../comments` for the comments feature. `/comments` CORS is restricted to an allowlist: `nathanpenny.fun`, `blog.nathanpenny.fun`, `nathanpenny520.github.io`, `localhost:8080`; other origins get no `Access-Control-Allow-Origin` header at all (`/api/ai` allows `*`).

## Other notes

- `audio/` holds a single mp3 used by one blog post; `pdfs/` and `docs/` hold the CV download; `docs/achievements.md` explains how to fill in the achievements page.
- `learning-resource/` is gitignored (personal study notes) and is not part of the site.
- Google Analytics 4 is loaded in `main.js` with a hardcoded measurement ID (`G-5X78JT0JSQ`), deferred until after window `load` + idle so unreachable regions (mainland China) don't stall page load. Cloudflare Web Analytics is also active, auto-injected by the Cloudflare dashboard.
- Third-party assets are self-hosted for China accessibility: Open Sans (latin 400, the only weight in use) via a `@font-face` at the top of `style.css`, Font Awesome 6.5.2 as a vendored copy in `fonts/fontawesome/` (woff2 only; `fa-regular` is unused but declared), and highlight.js 11.9.0 (common bundle, BSD-3 header intact) at `scripts/vendor/highlight.min.js` — `main.js` `initCodeHighlight()` injects it only on pages that actually contain `language-`-tagged code blocks, and the token colors are the site's own `--hljs-*` vars in `style.css` (no stock theme). The pages load no CSS/JS from external CDNs.
- The site logo is `NP-logo.svg`; `images/NathanPenny.png` is the avatar used in About/Gallery.
