# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A hand-rolled static personal website + blog (`nathanpenny.fun`) with no build step, no package.json, and no framework. Frontend is plain HTML/CSS/vanilla JS; the only backend is a Cloudflare Worker (`workers/comments.js`) backed by a Cloudflare D1 SQLite database for the comments (plus a legacy `visitors` table/endpoint no longer used by the frontend). All site text/content is authored directly in the HTML files.

## Commands

There is no build, lint, or test tooling — nothing to install.

- **Preview locally**: serve the repo root with any static file server, e.g. `python -m http.server 8080` (port 8080 is the dev origin allowed by the Worker's CORS list, so the visitor/comment features work locally too).
- **Regenerate blog post pages**: `python3 tools/gen_post_pages.py` (see Blog content below).
- **Deploy the site**: `git push origin main` — the host (GitHub Pages and/or the main domain) picks up the pushed files. Images, HTML, CSS, and JSON are pushed as-is.
- **Deploy the Worker**: the code in `workers/comments.js` is deployed manually to Cloudflare (see `workers/README.md`); it is NOT part of the git-deployed static site.

## Architecture

### Static pages

Six pages share an identical, hand-copied `nav` + `footer` block (there is no templating):

- `index.html` — home
- `pages/about.html` — profile and CV download
- `pages/blog.html` — all blog posts as inline `<article>` blocks
- `pages/gallery.html` — image grid + lightbox
- `pages/games.html` — the games page (UFO Battle shooter; more games can be added as `.game-card` blocks)
- `pages/contact.html` — social links, comment form

Because pages live one level deep, **paths inside `pages/*.html` use `../` prefixes** for CSS, JS, images, and logo; `index.html` uses plain `./`. When adding a new page, copy the nav/footer from an existing page and fix the `../` prefixes.

Friendly URLs (`/about`, `/blog`, ...) are mapped to the `pages/` files by `_redirects`. `404.html` (UFO-themed) is served with HTTP 404 for any URL matching no real asset — it uses root-absolute asset paths because it renders at arbitrary depths.

### PWA

`manifest.json` + `sw.js` (service worker) + `images/icon-{180,192,512}.png` make the site installable and available offline. `sw.js` precaches the site shell and serves pages network-first (so deploys show up) and static assets cache-first. Bump `CACHE_VERSION` in `sw.js` when a deploy changes cached assets in a way users must see immediately.

### Stylesheets

`styles/style.css` is the site's own stylesheet, organized top-to-bottom by page into sections marked with banner comments: `GLOBAL BASICS & RESETS`, `LAYOUT`, `HEADER & NAVIGATION`, `ABOUT PAGE`, `BLOG PAGE`, `GALLERY PAGE`, `CONTACT PAGE`, `COMMENTS`, `FOOTER`, `WIDGETS: PROGRESS BAR, BACK TO TOP, UFO EASTER EGG, TOAST`. All colors are CSS custom properties defined in `:root`; the dark palette lives in TWO sync'd blocks — `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` (auto) and `:root[data-theme="dark"]` (manual toggle) — keep them in sync when changing colors. Add new styles under the matching section banner rather than at the end of the file.

The only other stylesheet is the vendored `fonts/fontawesome/css/all.min.css` (self-hosted Font Awesome 6.5.2, see Other notes).

### Scripts

`scripts/main.js` is loaded with `defer` on every page. It handles GA4, blog scroll/search, gallery + lightbox, comments, the WeChat QR modal, the theme toggle (light/dark/system, persisted in `localStorage`), blog reading extras (progress bar, TOC scrollspy, reading time, back-to-top), the home starfield (full-page dark-mode canvas: twinkling stars, meteors, the occasional rock that hits the page — `#starField` + `skyBuildStars`/`skyDrawFrame`/`initStarField`, dark-mode only via CSS opacity), scroll reveal (`[data-reveal]`), the UFO easter egg, and service-worker registration. `scripts/games.js` is loaded ONLY by `pages/games.html`; everything is wrapped in an IIFE guarded by an element null-check, so other pages never run it. Each page's `<head>` also contains a tiny inline script that applies the saved theme before first paint to avoid a flash — update it in all five pages if the `theme` storage key changes. Key patterns:

- Everything is initialized in the `DOMContentLoaded` listener at the bottom.
- Each feature is guarded by `document.getElementById(...)` null-checks, so the one shared script can run on every page without erroring where a feature doesn't exist. Match this pattern for new features.
- All user-provided content (names, emails, comment text) is passed through the local `escapeHtml()` helper before being injected into `innerHTML` — never render user input unescaped.

### Gallery data

`data/gallery.json` is the source of truth for the gallery page (it is fetched at runtime via `fetch('../data/gallery.json')`). To add an image: drop the file in `images/` (blog images conventionally live under `images/blog-img/<date>/`), then add a JSON entry with `id`, `src`, `title`, `description`, `category`, `date`. Categories are auto-derived from the data to build the filter buttons.

### Blog content

Posts are static `<article id="post-..." class="blog-card">` blocks written directly into `pages/blog.html`, and each also has a generated single-post page at `blog/<slug>/index.html` (slug = the id without the `post-` prefix). To publish or edit a post:

1. Add/edit the article in `pages/blog.html` and a matching TOC entry in the `.blog-toc` sidebar (`onclick` calls `scrollToBlogPost('post-...')`, so the `id` must match).
2. Add/edit its `<item>` in `feed.xml` — the item description doubles as the post's meta description.
3. Run `python3 tools/gen_post_pages.py` from the repo root. It (re)generates the `blog/<slug>/` pages — full `<head>` with canonical URL, article og tags and BlogPosting JSON-LD, sidebar post list, newer/older links — and also refreshes `sitemap.xml`, upgrades `feed.xml` item links to the permalinks, and wraps each post title on the blog list page in a `rel=bookmark` permalink. The script is stdlib-only and idempotent.

## Backend (Cloudflare Worker)

`workers/comments.js` is a single Cloudflare Worker module using a D1 binding named `env.DB`. Endpoints:

| Method | Path       | Purpose                                          |
|--------|------------|--------------------------------------------------|
| GET    | `/`        | List all visitor entries (`SELECT * FROM visitors`) |
| POST   | `/`        | Insert a visitor `{ name, email }` (legacy form) |
| GET    | `/comments`| List comments, `email` excluded from results     |
| POST   | `/comments`| Insert a comment `{ name, email, content, cf-turnstile-response }` — the token is verified server-side against Cloudflare siteverify (`TURNSTILE_SECRET` Worker secret; see `workers/README.md`) |

Schema (created manually in D1, see `workers/README.md`): a `visitors` table and a `comments` table (`id`, `name`, `email`, `content`, `created_at`). The frontend talks to the worker at `https://workers.nathanpenny.fun` (`API_URL` in `main.js`), and to `.../comments` for the comments feature. CORS is restricted to an allowlist: `nathanpenny.fun`, `blog.nathanpenny.fun`, `nathanpenny520.github.io`, `localhost:8080`.

## Other notes

- `audio/` holds a single mp3 used by one blog post; `pdfs/` and `docs/` hold the CV download.
- `learning-resource/` is gitignored (personal study notes) and is not part of the site.
- Google Analytics 4 is loaded in `main.js` with a hardcoded measurement ID (`G-5X78JT0JSQ`), deferred until after window `load` + idle so unreachable regions (mainland China) don't stall page load. Cloudflare Web Analytics is also active, auto-injected by the Cloudflare dashboard.
- Third-party assets are self-hosted under `fonts/` for China accessibility: Open Sans (latin 400, the only weight in use) via a `@font-face` at the top of `style.css`, and Font Awesome 6.5.2 as a vendored copy in `fonts/fontawesome/` (woff2 only; `fa-regular` is unused but declared). The pages load no CSS/JS from external CDNs.
- The site logo is `NP-logo.svg`; `images/NathanPenny.png` is the avatar used in About/Gallery.
