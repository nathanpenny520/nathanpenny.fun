# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A hand-rolled static personal website + blog (`nathanpenny.fun`) with no build step, no package.json, and no framework. Frontend is plain HTML/CSS/vanilla JS; the only backend is a Cloudflare Worker (`workers/comments.js`) backed by a Cloudflare D1 SQLite database for the comments (plus a legacy `visitors` table/endpoint no longer used by the frontend). All site text/content is authored directly in the HTML files.

## Commands

There is no build, lint, or test tooling — nothing to install.

- **Preview locally**: serve the repo root with any static file server, e.g. `python -m http.server 8080` (port 8080 is the dev origin allowed by the Worker's CORS list, so the visitor/comment features work locally too).
- **Deploy the site**: `git push origin main` — the host (GitHub Pages and/or the main domain) picks up the pushed files. Images, HTML, CSS, and JSON are pushed as-is.
- **Deploy the Worker**: the code in `workers/comments.js` is deployed manually to Cloudflare (see `workers/README.md`); it is NOT part of the git-deployed static site.

## Architecture

### Static pages

Five pages share an identical, hand-copied `nav` + `footer` block (there is no templating):

- `index.html` — home
- `pages/about.html` — profile and CV download
- `pages/blog.html` — all blog posts as inline `<article>` blocks
- `pages/gallery.html` — image grid + lightbox
- `pages/contact.html` — social links, comment form

Because pages live one level deep, **paths inside `pages/*.html` use `../` prefixes** for CSS, JS, images, and logo; `index.html` uses plain `./`. When adding a new page, copy the nav/footer from an existing page and fix the `../` prefixes.

Friendly URLs (`/about`, `/blog`, ...) are mapped to the `pages/` files by `_redirects`.

### PWA

`manifest.json` + `sw.js` (service worker) + `images/icon-{180,192,512}.png` make the site installable and available offline. `sw.js` precaches the site shell and serves pages network-first (so deploys show up) and static assets cache-first. Bump `CACHE_VERSION` in `sw.js` when a deploy changes cached assets in a way users must see immediately.

### Single stylesheet

`styles/style.css` is the only CSS file, organized top-to-bottom by page into sections marked with banner comments: `GLOBAL BASICS & RESETS`, `LAYOUT`, `HEADER & NAVIGATION`, `ABOUT PAGE`, `BLOG PAGE`, `GALLERY PAGE`, `CONTACT PAGE`, `COMMENTS`, `FOOTER`, `WIDGETS: PROGRESS BAR, BACK TO TOP, UFO EASTER EGG, TOAST`. All colors are CSS custom properties defined in `:root`; the dark palette lives in TWO sync'd blocks — `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` (auto) and `:root[data-theme="dark"]` (manual toggle) — keep them in sync when changing colors. Add new styles under the matching section banner rather than at the end of the file.

### Single script

`scripts/main.js` is the only JS file, loaded with `defer` on every page. It handles GA4, blog scroll/search, gallery + lightbox, comments, the WeChat QR modal, the theme toggle (light/dark/system, persisted in `localStorage`), blog reading extras (progress bar, TOC scrollspy, reading time, back-to-top), the UFO easter egg, and service-worker registration. Each page's `<head>` also contains a tiny inline script that applies the saved theme before first paint to avoid a flash — update it in all five pages if the `theme` storage key changes. Key patterns:

- Everything is initialized in the `DOMContentLoaded` listener at the bottom.
- Each feature is guarded by `document.getElementById(...)` null-checks, so the one shared script can run on every page without erroring where a feature doesn't exist. Match this pattern for new features.
- All user-provided content (names, emails, comment text) is passed through the local `escapeHtml()` helper before being injected into `innerHTML` — never render user input unescaped.

### Gallery data

`data/gallery.json` is the source of truth for the gallery page (it is fetched at runtime via `fetch('../data/gallery.json')`). To add an image: drop the file in `images/` (blog images conventionally live under `images/blog-img/<date>/`), then add a JSON entry with `id`, `src`, `title`, `description`, `category`, `date`. Categories are auto-derived from the data to build the filter buttons.

### Blog content

Posts are static `<article class="blog-card" id="post-...">` blocks written directly into `pages/blog.html`. To add a post, add an article there and add a matching TOC entry in the `.blog-toc` sidebar (`onclick` calls `scrollToBlogPost('post-...')`, so the `id` must match).

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
- Google Analytics 4 is loaded in `main.js` with a hardcoded measurement ID (`G-5X78JT0JSQ`).
- The site logo is `NP-logo.svg`; `images/NathanPenny.png` is the avatar used in About/Gallery.
