# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## Overview

A hand-rolled static personal website + blog (`nathanpenny.fun`) with no build step, no package.json, and no framework. Frontend is plain HTML/CSS/vanilla JS; the only backend is a Cloudflare Worker (`workers/comments.js`) backed by a Cloudflare D1 SQLite database for the comments. All site text/content is authored directly in the HTML files.

## Commands

There is no build, lint, or test tooling — nothing to install.

- **Preview locally**: serve the repo root with any static file server, e.g. `python -m http.server 8080` (port 8080 is the dev origin allowed by the Worker's CORS list, so the visitor/comment features work locally too).
- **Regenerate blog post pages**: `python3 tools/gen_post_pages.py` (see Blog content below).
- **Regenerate the music library catalog**: `python3 tools/gen_music_library.py` (see Creations data below).
- **Deploy the site**: `git push origin main` — the host (Cloudflare Pages, plus a mirror on GitHub Pages) picks up the pushed files. Images, HTML, CSS, and JSON are pushed as-is.
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

`scripts/main.js` is loaded with `defer` on every page. It handles GA4, the home latest-posts cards (rendered from `feed.xml` into `#latestPostsSection`), blog list search/filtering, gallery + lightbox, creations (featured cards, music library, bottom audio mini-player), comments, the WeChat QR modal, the theme toggle (light/dark/system, persisted in `localStorage`), blog reading extras (progress bar, reading time, back-to-top), the home starfield (full-page dark-mode canvas: twinkling stars, meteors, the occasional rock that hits the page — `#starField` + `skyBuildStars`/`skyDrawFrame`/`initStarField`, dark-mode only via CSS opacity), scroll reveal (`[data-reveal]`), the UFO easter egg, and service-worker registration. Each page's `<head>` also contains a tiny inline script that applies the saved theme before first paint to avoid a flash — update it in all of them (they are hand-copied) if the `theme` storage key changes. Key patterns:

- Everything is initialized in the `DOMContentLoaded` listener at the bottom.
- Each feature is guarded by `document.getElementById(...)` null-checks, so the one shared script can run on every page without erroring where a feature doesn't exist. Match this pattern for new features.
- All user-provided content (names, emails, comment text) is passed through the local `escapeHtml()` helper before being injected into `innerHTML` — never render user input unescaped.

### Gallery data

`data/gallery.json` is the source of truth for the gallery page (it is fetched at runtime via `fetch('../data/gallery.json')`). To add an image: drop the file in `images/` (blog images conventionally live under `images/blog-img/<date>/`), then add a JSON entry with `id`, `src`, `title`, `description`, `category`, `date`. Categories are auto-derived from the data to build the filter buttons.

### Creations data

`pages/creations.html` is driven by two JSON files fetched at runtime, and is deliberately independent of the blog (no cross-links). `data/creations.json` (hand-maintained) holds the featured items: `{id, type: song|video, origin: original|favorite, title, description, src, poster, cover, date}` — paths relative to `pages/`; `origin` is recorded but not rendered. `data/music-library.json` is GENERATED by `tools/gen_music_library.py` from the local, gitignored `audio/my-music/` library (`Artist/Album/Title-Album-Artist.ext` layout; cover art is downloaded into `images/music-covers/`). The audio files themselves are NOT in the repo: upload them to the R2 bucket `nathanpenny-fun` behind `storage.nathanpenny.fun` via `tools/upload_music_r2.sh nathanpenny-fun` (keys under `music/`). CI never regenerates the library JSON — run the script locally when the library changes.

### Blog content

Each post lives in `posts/<slug>.md`: frontmatter (`title`, `date: YYYY-MM-DD`, optional `description` — falls back to the first paragraph, `category` — one of the fixed slugs in the generator's `CATEGORIES` dict, defaults to `misc`, and `tags` — comma separated) plus a Markdown body. Raw HTML blocks pass through untouched (video/audio embeds, tables, images with explicit width/height); plain markdown images automatically get the `blog-img` class; body headings shift down one level (`#` renders as h2); asset paths are relative to `pages/` (`../images/...`) and are pushed one level deeper automatically for the single-post pages.

Publishing = edit/create the `.md` and push: CI (`.github/workflows/gen-posts.yml`) runs the generator and commits the results back to main. Running `python3 tools/gen_post_pages.py` locally does the same. The generator (stdlib-only, idempotent) regenerates, newest post first everywhere: the category filter chips and the `<article>` cards in `pages/blog.html` between the `posts:filters` / `posts:articles` marker pairs (everything else in that file is hand-maintained — don't edit inside the markers), the single-post pages `blog/<slug>/index.html` (canonical URL, article og tags, BlogPosting JSON-LD, category badge, sidebar with the all-posts TOC, newer/older nav), `feed.xml`, and `sitemap.xml`.

## Backend (Cloudflare Worker)

`workers/comments.js` is a single Cloudflare Worker module using a D1 binding named `env.DB`. Endpoints:

| Method | Path       | Purpose                                          |
|--------|------------|--------------------------------------------------|
| GET    | `/comments`| List comments, `email` excluded from results     |
| POST   | `/comments`| Insert a comment `{ name, email, content, cf-turnstile-response }` — capped at 5 attempts/60s per IP via the `comment_rate` D1 table (checked first, see `checkRateLimit()`), then the Turnstile token is verified server-side against Cloudflare siteverify (`TURNSTILE_SECRET` Worker secret; see `workers/README.md`) |

Any other path returns 404. Schema (created manually in D1, see `workers/README.md`): a `comments` table (`id`, `name`, `email`, `content`, `created_at`) and a `comment_rate` table for the per-IP rate limit. The frontend talks to the worker at `https://workers.nathanpenny.fun` (`API_URL` in `main.js`), and to `.../comments` for the comments feature. CORS is restricted to an allowlist: `nathanpenny.fun`, `blog.nathanpenny.fun`, `nathanpenny520.github.io`, `localhost:8080`; other origins get no `Access-Control-Allow-Origin` header at all.

## Other notes

- `audio/` holds a single mp3 used by one blog post; `pdfs/` and `docs/` hold the CV download; `docs/achievements.md` explains how to fill in the achievements page.
- `learning-resource/` is gitignored (personal study notes) and is not part of the site.
- Google Analytics 4 is loaded in `main.js` with a hardcoded measurement ID (`G-5X78JT0JSQ`), deferred until after window `load` + idle so unreachable regions (mainland China) don't stall page load. Cloudflare Web Analytics is also active, auto-injected by the Cloudflare dashboard.
- Third-party assets are self-hosted under `fonts/` for China accessibility: Open Sans (latin 400, the only weight in use) via a `@font-face` at the top of `style.css`, and Font Awesome 6.5.2 as a vendored copy in `fonts/fontawesome/` (woff2 only; `fa-regular` is unused but declared). The pages load no CSS/JS from external CDNs.
- The site logo is `NP-logo.svg`; `images/NathanPenny.png` is the avatar used in About/Gallery; `images/NP.png` is a spare logo design not referenced by the site.
