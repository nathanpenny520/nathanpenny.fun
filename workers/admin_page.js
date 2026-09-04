// Self-hosted admin page served by GET /admin in comments.js: six tabs —
// the image uploader, the markdown 写作台 (editor tab from editor_page.js),
// the content data editors (content_page.js), the AI playground (ai_page.js),
// the analytics stats tab (stats_page.js) and the comment-moderation tab
// (comments_tab.js) — all interpolated below. Styling mirrors the site
// frontend (frosted nav +
// palette from styles/style.css). Self-contained (inline CSS/JS, noindex);
// the only cross-origin asset is the site logo, loaded as an <img> from
// nathanpenny.fun. This file is one template literal, so the page's own
// script deliberately avoids backticks and ${}.
import { EDITOR_TAB_HTML } from "./editor_page.js";
import { CONTENT_TAB_HTML } from "./content_page.js";
import { AI_TAB_HTML } from "./ai_page.js";
import { STATS_TAB_HTML } from "./stats_page.js";
import { COMMENTS_TAB_HTML } from "./comments_tab.js";

export const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>NP · Admin</title>
<script>
  // Apply the saved color theme before first paint (same key as the site).
  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) {}
</script>
<style>
  :root {
    color-scheme: light dark;

    /* Frontend palette, ported from styles/style.css — keep in sync */
    --color-bg: #f5f7fa;
    --color-surface: #fff;
    --color-surface-alt: #f8f9fa;
    --color-text: #333;
    --color-text-soft: #34495e;
    --color-text-muted: #7f8c8d;
    --color-heading: #2c3e50;
    --color-link: #0066cc;
    --color-link-hover: #004099;
    --color-accent: #1abc9c;
    --color-accent-strong: #16a085;
    --color-success: #27ae60;
    --color-danger: #e74c3c;
    --color-border: #d0d7de;
    --color-border-light: #e0e0e0;

    /* Apple-style frosted nav */
    --nav-h: 52px;
    --nav-bg: rgba(255, 255, 255, 0.72);
    --nav-hover-bg: rgba(0, 0, 0, 0.05);
    --shadow-card: 0 2px 12px rgba(0, 0, 0, 0.08);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --color-bg: #171d24;
      --color-surface: #222a33;
      --color-surface-alt: #2b343e;
      --color-text: #ccd4dc;
      --color-text-soft: #b8c2cc;
      --color-text-muted: #8a97a4;
      --color-heading: #e8edf2;
      --color-link: #6ab0f3;
      --color-link-hover: #9ccaf5;
      --color-accent: #1abc9c;
      --color-accent-strong: #48d1b4;
      --color-success: #2ecc71;
      --color-danger: #ff6f61;
      --color-border: #3b4550;
      --color-border-light: #303a44;
      --nav-h: 52px;
      --nav-bg: rgba(16, 22, 28, 0.72);
      --nav-hover-bg: rgba(255, 255, 255, 0.1);
      --shadow-card: 0 2px 12px rgba(0, 0, 0, 0.45);
    }
  }
  /* Manual dark theme (theme toggle) — keep this block in sync with the
     media-query block above, exactly like the frontend does */
  :root[data-theme="dark"] {
    color-scheme: dark;
    --color-bg: #171d24;
    --color-surface: #222a33;
    --color-surface-alt: #2b343e;
    --color-text: #ccd4dc;
    --color-text-soft: #b8c2cc;
    --color-text-muted: #8a97a4;
    --color-heading: #e8edf2;
    --color-link: #6ab0f3;
    --color-link-hover: #9ccaf5;
    --color-accent: #1abc9c;
    --color-accent-strong: #48d1b4;
    --color-success: #2ecc71;
    --color-danger: #ff6f61;
    --color-border: #3b4550;
    --color-border-light: #303a44;
    --nav-h: 52px;
    --nav-bg: rgba(16, 22, 28, 0.72);
    --nav-hover-bg: rgba(255, 255, 255, 0.1);
    --shadow-card: 0 2px 12px rgba(0, 0, 0, 0.45);
  }
  :root[data-theme="light"] { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--color-bg); color: var(--color-text);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft Yahei", sans-serif;
  }
  /* Same measure as the frontend .container (90% / 1100px); the editor tab
     keeps its wider two-pane layout. */
  main { width: 90%; max-width: 1100px; margin: 28px auto 64px; }
  main.ed-wide { max-width: 1240px; }
  h2 { font-size: 16px; margin: 0; color: var(--color-heading); }
  .hint { color: var(--color-text-muted); margin: 0 0 20px; font-size: 13.5px; }
  a { color: var(--color-link); }
  a:hover { color: var(--color-link-hover); }

  /* ---- Top nav (ported from the site's frosted navbar) ---- */
  #adminNav {
    position: sticky; top: 0; z-index: 99; height: var(--nav-h);
    background: var(--nav-bg);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    /* The border is always present but transparent, so the scrolled state
       below never changes the nav height (same trick as the site nav) */
    border-bottom: 1px solid transparent;
    transition: border-color 0.3s ease, box-shadow 0.3s ease;
  }
  #adminNav.scrolled {
    border-bottom-color: var(--color-border-light);
    box-shadow: 0 1px 12px rgba(0, 0, 0, 0.06);
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    #adminNav { background: var(--color-surface); }
  }
  .nav-container {
    width: 90%; max-width: 1100px; margin: 0 auto; height: 100%;
    display: flex; align-items: center; gap: 28px;
  }
  .nav-brand {
    display: flex; align-items: center; gap: 10px; margin-right: auto;
    min-width: 0; text-decoration: none;
  }
  /* White chip keeps the dark logo marks readable in both themes */
  .site-logo {
    width: 28px; height: 28px; border-radius: 6px; object-fit: contain;
    background: #fff; padding: 2px; flex-shrink: 0;
  }
  .logo {
    color: var(--color-heading); font-size: 17px; font-weight: 600;
    letter-spacing: 0.01em; white-space: nowrap; min-width: 0;
    overflow: hidden; text-overflow: ellipsis;
  }
  .nav-links { display: flex; align-items: center; gap: 26px; }
  /* Section links styled like the site's .nav-list links: quiet text that
     lights up on hover, teal for the active section. */
  .nav-link {
    border: none; background: none; padding: 0; cursor: pointer;
    font: inherit; font-size: 14px; letter-spacing: 0.02em;
    color: var(--color-heading); opacity: 0.78; text-decoration: none;
    transition: opacity 0.2s ease, color 0.2s ease;
  }
  .nav-link:hover { opacity: 1; }
  .nav-link.active { opacity: 1; color: var(--color-accent-strong); }
  /* Round icon buttons in the nav bar (external link, theme toggle) */
  .nav-icon {
    border: none; background: transparent; color: var(--color-heading);
    width: 38px; height: 38px; border-radius: 50%; cursor: pointer;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    padding: 0; text-decoration: none; transition: background 0.2s ease;
  }
  .nav-icon:hover { background: var(--nav-hover-bg); }
  .nav-icon svg { display: block; }
  .nav-icon svg[hidden] { display: none; }
  *:focus-visible { outline: 2px solid var(--color-accent-strong); outline-offset: 2px; }
  @media (max-width: 820px) {
    :root { --nav-h: 48px; }
    .nav-container { gap: 14px; }
    .nav-links { gap: 13px; }
  }
  /* On tiny phones the four links + two icons need the brand text gone */
  @media (max-width: 520px) {
    .logo { display: none; }
  }
  #tabUpload .fm-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 14px; }
  .fm-crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; font-size: 13.5px; min-width: 0; }
  .fm-crumbs button {
    border: none; background: none; padding: 3px 6px; color: var(--color-accent);
    cursor: pointer; font: inherit; font-size: 13.5px; font-weight: 600;
  }
  .fm-crumbs button:hover { text-decoration: underline; }
  .fm-crumbs .fm-sep { color: var(--color-text-muted); }
  .fm-crumbs .fm-here { padding: 3px 6px; font-weight: 600; }
  .fm-spacer { flex: 1; }
  #fmSort { font: inherit; font-size: 13px; padding: 5px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text); }
  #fmGrid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px;
    min-height: 140px; padding: 4px; border-radius: 12px; align-content: start;
  }
  #fmGrid.drag { outline: 2px dashed var(--color-accent); background: var(--color-surface-alt); }
  .fm-card {
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px;
    padding: 8px; cursor: pointer; position: relative; text-align: center; overflow: hidden;
  }
  .fm-card:hover { border-color: var(--color-accent); box-shadow: var(--shadow-card); }
  .fm-card img {
    width: 100%; height: 100px; object-fit: cover; border-radius: 6px;
    display: block; background: var(--color-bg);
  }
  .fm-card .fm-icon { font-size: 34px; height: 100px; display: flex; align-items: center; justify-content: center; }
  .fm-name {
    font-size: 12.5px; margin-top: 6px; word-break: break-all; text-align: left;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .fm-card .fm-meta { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; text-align: left; }
  .fm-tools { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
  .fm-card:hover .fm-tools { opacity: 1; }
  .fm-tools button { padding: 2px 6px; font-size: 11px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); }
  /* Touch devices have no hover — keep the card actions visible there */
  @media (hover: none) { .fm-tools { opacity: 1; } }
  #fmDetail {
    border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text);
    padding: 18px; max-width: 560px; width: calc(100% - 32px);
  }
  #fmDetail::backdrop { background: rgba(0, 0, 0, .45); }
  #fmDetail img { max-width: 100%; max-height: 320px; border-radius: 8px; display: block; margin: 0 auto 12px; background: var(--color-bg); }
  #fmDetail h2 { margin: 0 0 10px; word-break: break-all; }
  #fmDetail .fm-key { font-size: 12px; color: var(--color-text-muted); word-break: break-all; display: block; margin-bottom: 8px; }
  section { margin-top: 26px; }
  .recent-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  button {
    font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px;
    border: 1px solid var(--color-border); background: var(--color-surface);
    color: var(--color-text); cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
  }
  button:hover { border-color: var(--color-accent); }
  button.primary { background: var(--color-accent-strong); border-color: var(--color-accent-strong); color: #fff; }
  button.primary:hover { background: #12856f; border-color: #12856f; color: #fff; }
  button.danger:hover { border-color: var(--color-danger); color: var(--color-danger); }
  button:disabled { opacity: 0.55; cursor: default; }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px;
    padding: 10px 12px; margin-bottom: 8px;
  }
  li:hover { background: var(--color-surface-alt); }
  .row-main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .name { font-weight: 600; word-break: break-all; }
  .meta { color: var(--color-text-muted); font-size: 12.5px; }
  .status { font-size: 12.5px; }
  .status.ok { color: var(--color-success); }
  .status.err { color: var(--color-danger); }
  .url {
    display: block; width: 100%; margin: 6px 0; padding: 6px 8px; font-size: 12.5px;
    border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-bg);
    color: var(--color-text); font-family: ui-monospace, monospace; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  #toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(8px);
    background: var(--color-text); color: var(--color-bg); padding: 8px 16px; border-radius: 8px;
    font-size: 13.5px; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;
    z-index: 10;
  }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .empty { color: var(--color-text-muted); font-size: 13.5px; padding: 10px 2px; }
</style>
</head>
<body>
<nav id="adminNav" aria-label="Admin sections">
  <div class="nav-container">
    <a class="nav-brand" href="https://nathanpenny.fun/" target="_blank" rel="noopener" title="Open nathanpenny.fun">
      <img class="site-logo" src="https://nathanpenny.fun/NP-logo.svg" alt="Nathan Penny logo">
      <span class="logo">NP Admin</span>
    </a>
    <div class="nav-links">
      <button id="tabBtnUpload" class="nav-link active" type="button">Images</button>
      <button id="tabBtnEditor" class="nav-link" type="button">Editor</button>
      <button id="tabBtnContent" class="nav-link" type="button">Content</button>
      <button id="tabBtnAi" class="nav-link" type="button">AI</button>
      <button id="tabBtnStats" class="nav-link" type="button">Stats</button>
      <button id="tabBtnComments" class="nav-link" type="button">Comments</button>
    </div>
    <a class="nav-icon" href="https://nathanpenny.fun/" target="_blank" rel="noopener" title="Open the site" aria-label="Open the site">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><path d="M15 3h6v6"></path><path d="M10 14L21 3"></path></svg>
    </a>
    <button id="themeToggle" class="nav-icon" type="button" title="Switch theme" aria-label="Switch theme">
      <svg id="iconMoon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
      <svg id="iconSun" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>
    </button>
  </div>
</nav>

<main>

  <section id="tabUpload">
  <p class="hint">Drag &amp; drop, paste (Ctrl/Cmd+V), or use Upload. Files land in the folder you are viewing (the root keeps the <code>img/YYYY/MM/</code> layout) and are served from storage.nathanpenny.fun. PNG · JPG · WebP · GIF · AVIF · SVG, up to 25 MB each.</p>

  <div class="fm-bar">
    <nav id="fmCrumbs" class="fm-crumbs" aria-label="Folder path"></nav>
    <span class="fm-spacer"></span>
    <select id="fmSort" aria-label="Sort files">
      <option value="date">Newest first</option>
      <option value="name">Name</option>
      <option value="size">Size</option>
    </select>
    <button id="fmRecentBtn" type="button" title="Flat list of the latest uploads">Recent</button>
    <button id="fmNewFolder" type="button">+ Folder</button>
    <button id="fmUploadBtn" type="button" class="primary">Upload</button>
  </div>
  <input id="fileInput" type="file" multiple hidden
         accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.svg,image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml">

  <div id="fmGrid" aria-label="Files"></div>
  <p class="empty" id="fmEmpty" hidden>This folder is empty.</p>

  <section id="queueSection" hidden>
    <div class="recent-head"><h2>Uploading…</h2></div>
    <ul id="queue"></ul>
  </section>

  <dialog id="fmDetail">
    <h2 id="fmDetailName"></h2>
    <img id="fmDetailImg" alt="" hidden>
    <code id="fmDetailKey" class="fm-key"></code>
    <input id="fmDetailUrl" class="url" readonly aria-label="Image URL">
    <div class="actions">
      <button id="fmCopyUrl" type="button">Copy URL</button>
      <button id="fmCopyMd" type="button">Copy Markdown</button>
      <button id="fmRename" type="button">Rename</button>
      <button id="fmMove" type="button">Move…</button>
      <button id="fmDelete" type="button" class="danger">Delete</button>
      <span class="fm-spacer"></span>
      <button id="fmClose" type="button">Close</button>
    </div>
  </dialog>
  </section>
  ${EDITOR_TAB_HTML}
  ${CONTENT_TAB_HTML}
  ${AI_TAB_HTML}
  ${STATS_TAB_HTML}
  ${COMMENTS_TAB_HTML}
</main>
<div id="toast" role="status" aria-live="polite"></div>

<script>
(function () {
  "use strict";

  var tabUpload = document.getElementById("tabUpload");
  var tabEditor = document.getElementById("tabEditor");
  var tabContent = document.getElementById("tabContent");
  var tabAi = document.getElementById("tabAi");
  var tabStats = document.getElementById("tabStats");
  var tabComments = document.getElementById("tabComments");
  var btnUpload = document.getElementById("tabBtnUpload");
  var btnEditor = document.getElementById("tabBtnEditor");
  var btnContent = document.getElementById("tabBtnContent");
  var btnAi = document.getElementById("tabBtnAi");
  var btnStats = document.getElementById("tabBtnStats");
  var btnComments = document.getElementById("tabBtnComments");

  function showTab(which) {
    var editorActive = which === "editor" || which === "content";
    tabUpload.hidden = which !== "upload";
    tabEditor.hidden = which !== "editor";
    tabContent.hidden = which !== "content";
    tabAi.hidden = which !== "ai";
    tabStats.hidden = which !== "stats";
    tabComments.hidden = which !== "comments";
    btnUpload.className = "nav-link" + (which === "upload" ? " active" : "");
    btnEditor.className = "nav-link" + (which === "editor" ? " active" : "");
    btnContent.className = "nav-link" + (which === "content" ? " active" : "");
    btnAi.className = "nav-link" + (which === "ai" ? " active" : "");
    btnStats.className = "nav-link" + (which === "stats" ? " active" : "");
    btnComments.className = "nav-link" + (which === "comments" ? " active" : "");
    // The editor and content tabs' two-pane layouts need more width.
    document.querySelector("main").classList.toggle("ed-wide", editorActive);
  }

  btnUpload.addEventListener("click", function () { showTab("upload"); });
  btnEditor.addEventListener("click", function () { showTab("editor"); });
  btnContent.addEventListener("click", function () { showTab("content"); });
  btnAi.addEventListener("click", function () { showTab("ai"); });
  btnStats.addEventListener("click", function () { showTab("stats"); });
  btnComments.addEventListener("click", function () { showTab("comments"); });

  // Frosted-nav border/shadow once the page scrolls (site's .nav-scrolled).
  var adminNav = document.getElementById("adminNav");
  function onNavScroll() {
    adminNav.classList.toggle("scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onNavScroll, { passive: true });
  onNavScroll();

  // Theme toggle — same storage key and behaviour as the site (main.js):
  // an explicit light/dark choice persisted in localStorage["theme"].
  var THEME_KEY = "theme";
  var themeBtn = document.getElementById("themeToggle");
  var iconMoon = document.getElementById("iconMoon");
  var iconSun = document.getElementById("iconSun");

  function effectiveTheme() {
    var explicit = document.documentElement.dataset.theme;
    if (explicit === "light" || explicit === "dark") return explicit;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function updateThemeToggle() {
    // The button shows what clicking will switch to: moon in light mode, sun in dark.
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    iconMoon.hidden = next !== "dark";
    iconSun.hidden = next !== "light";
    themeBtn.title = "Switch to " + next + " mode";
    themeBtn.setAttribute("aria-label", themeBtn.title);
  }
  themeBtn.addEventListener("click", function () {
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    updateThemeToggle();
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  });
  updateThemeToggle();

  // The editor tab (editor_page.js) takes over paste/drop of images while it
  // is the visible tab; the uploader defers to it below.
  window.npEditorActive = function () { return !tabEditor.hidden; };

  showTab("upload");
})();
</script>

<script>
(function () {
  "use strict";

  // File-explorer UI over the R2 img/ prefix. Folders are key prefixes with
  // one level listed per request (delimiter); the server hides the .keep
  // folder markers. All mutating calls go to /upload, /upload/folder and
  // /upload/move (see comments.js).
  var MAX_BYTES = 25 * 1024 * 1024;
  var STORAGE_ORIGIN = "https://storage.nathanpenny.fun/";
  var FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

  var fileInput = document.getElementById("fileInput");
  var queueEl = document.getElementById("queue");
  var queueSection = document.getElementById("queueSection");
  var grid = document.getElementById("fmGrid");
  var emptyMsg = document.getElementById("fmEmpty");
  var crumbsEl = document.getElementById("fmCrumbs");
  var sortSel = document.getElementById("fmSort");
  var toastEl = document.getElementById("toast");
  var detail = document.getElementById("fmDetail");

  var cwd = "img/";
  var recentMode = false;
  var folders = [];
  var objects = [];
  var currentDetail = null; // {key,url} of the open detail dialog

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  function copyText(text, label) {
    function done() { toast(label + " copied"); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function parentOf(path) {
    var parts = path.replace(/\\/+$/, "").split("/");
    parts.pop();
    return parts.length ? parts.join("/") + "/" : "img/";
  }

  // --- listing ------------------------------------------------------------

  function reload() {
    if (recentMode) loadRecent();
    else loadFolder();
  }

  function loadFolder() {
    fetch("/upload?list=1&delimiter=1&prefix=" + encodeURIComponent(cwd))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        folders = data.folders || [];
        objects = data.objects || [];
        renderCrumbs();
        renderGrid();
      })
      .catch(function () { toast("Could not load the folder"); });
  }

  function loadRecent() {
    fetch("/upload?list=1")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        folders = [];
        objects = data.objects || [];
        renderCrumbs();
        renderGrid();
      })
      .catch(function () { toast("Could not load uploads"); });
  }

  function navigate(path) {
    cwd = path;
    recentMode = false;
    loadFolder();
  }

  function renderCrumbs() {
    crumbsEl.textContent = "";
    function crumb(label, path) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", function () { navigate(path); });
      crumbsEl.appendChild(b);
    }
    var sep = function () {
      var s = document.createElement("span");
      s.className = "fm-sep";
      s.textContent = "/";
      crumbsEl.appendChild(s);
    };
    if (recentMode) {
      crumb("img", "img/");
      sep();
      var here = document.createElement("span");
      here.className = "fm-here";
      here.textContent = "Recent uploads";
      crumbsEl.appendChild(here);
      return;
    }
    crumb("img", "img/");
    var path = "img/";
    cwd.slice(4).split("/").forEach(function (part) {
      if (!part) return;
      path += part + "/";
      sep();
      if (path === cwd) {
        var here = document.createElement("span");
        here.className = "fm-here";
        here.textContent = part;
        crumbsEl.appendChild(here);
      } else {
        crumb(part, path);
      }
    });
  }

  function sortedObjects() {
    var list = objects.slice();
    var mode = sortSel.value;
    if (mode === "name") list.sort(function (a, b) { return a.key.localeCompare(b.key); });
    else if (mode === "size") list.sort(function (a, b) { return b.size - a.size; });
    else list.sort(function (a, b) { return String(b.uploaded || "").localeCompare(String(a.uploaded || "")); });
    return list;
  }

  function toolBtn(label, title, cls, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    if (cls) b.className = cls;
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
    return b;
  }

  function renderGrid() {
    grid.textContent = "";
    var folderPaths = recentMode ? [] : folders.slice().sort();
    folderPaths.forEach(function (path) {
      var name = path.replace(/\\/+$/, "").split("/").pop();
      var card = document.createElement("div");
      card.className = "fm-card";
      card.setAttribute("role", "button");
      card.title = "Open folder " + name;
      var icon = document.createElement("div");
      icon.className = "fm-icon";
      icon.textContent = "📁";
      var label = document.createElement("div");
      label.className = "fm-name";
      label.textContent = name;
      var tools = document.createElement("div");
      tools.className = "fm-tools";
      tools.appendChild(toolBtn("✏️", "Rename folder", "", function () { renameFolder(path); }));
      tools.appendChild(toolBtn("🗑", "Delete folder", "danger", function () { deleteFolder(path); }));
      card.appendChild(tools);
      card.appendChild(icon);
      card.appendChild(label);
      card.addEventListener("click", function () { navigate(path); });
      grid.appendChild(card);
    });

    var files = sortedObjects();
    files.forEach(function (obj) {
      var name = obj.key.split("/").pop();
      var card = document.createElement("div");
      card.className = "fm-card";
      card.setAttribute("role", "button");
      card.title = name;
      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = obj.url;
      img.alt = name;
      var label = document.createElement("div");
      label.className = "fm-name";
      label.textContent = name;
      var meta = document.createElement("div");
      meta.className = "fm-meta";
      meta.textContent = fmtBytes(obj.size) + (obj.uploaded ? " · " + new Date(obj.uploaded).toLocaleDateString() : "");
      var tools = document.createElement("div");
      tools.className = "fm-tools";
      tools.appendChild(toolBtn("⤢", "Details", "", function () { openDetail(obj); }));
      tools.appendChild(toolBtn("🗑", "Delete file", "danger", function () { deleteFile(obj); }));
      card.appendChild(tools);
      card.appendChild(img);
      card.appendChild(label);
      card.appendChild(meta);
      card.addEventListener("click", function () { openDetail(obj); });
      grid.appendChild(card);
    });

    emptyMsg.hidden = folderPaths.length + files.length > 0;
    emptyMsg.textContent = recentMode ? "Nothing uploaded yet." : "This folder is empty.";
  }

  // --- folder actions -----------------------------------------------------

  function newFolder() {
    var name = window.prompt("New folder name (lowercase letters, digits, hyphen):");
    if (name == null) return;
    name = name.trim();
    if (!FOLDER_SEGMENT_RE.test(name)) {
      toast("Invalid folder name");
      return;
    }
    var path = cwd + name + "/";
    fetch("/upload/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: path })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        toast("Folder created");
        navigate(path);
      })
      .catch(function () { toast("Could not create the folder"); });
  }

  function renameFolder(path) {
    var name = path.replace(/\\/+$/, "").split("/").pop();
    var next = window.prompt("Rename folder to:", name);
    if (next == null) return;
    next = next.trim();
    if (!next || next === name) return;
    if (!FOLDER_SEGMENT_RE.test(next)) {
      toast("Invalid folder name");
      return;
    }
    fetch("/upload/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: path, to: parentOf(path) + next + "/" })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        toast("Renamed (" + data.moved + " files)");
        navigate(parentOf(path) + next + "/");
      })
      .catch(function () { toast("Rename failed"); });
  }

  function deleteFolder(path) {
    var name = path.replace(/\\/+$/, "").split("/").pop();
    if (!window.confirm("Delete folder " + name + " and EVERY file inside it? This cannot be undone.")) return;
    fetch("/upload/folder?key=" + encodeURIComponent(path), { method: "DELETE" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        toast("Deleted " + data.deleted + " files");
        navigate(parentOf(path));
      })
      .catch(function () { toast("Delete failed"); });
  }

  // --- file actions ---------------------------------------------------------

  function deleteFile(obj) {
    if (!window.confirm("Delete " + obj.key + " from R2? This cannot be undone.")) return;
    fetch("/upload?key=" + encodeURIComponent(obj.key), { method: "DELETE" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        toast("Deleted");
        detail.close();
        reload();
      })
      .catch(function () { toast("Delete failed"); });
  }

  function openDetail(obj) {
    currentDetail = obj;
    document.getElementById("fmDetailName").textContent = obj.key.split("/").pop();
    var img = document.getElementById("fmDetailImg");
    img.src = obj.url;
    img.hidden = false;
    document.getElementById("fmDetailKey").textContent = obj.key;
    document.getElementById("fmDetailUrl").value = obj.url;
    detail.showModal();
  }

  document.getElementById("fmCopyUrl").addEventListener("click", function () {
    if (currentDetail) copyText(currentDetail.url, "URL");
  });
  document.getElementById("fmCopyMd").addEventListener("click", function () {
    if (!currentDetail) return;
    var alt = currentDetail.key.split("/").pop().replace(/\\.[^.]+$/, "").replace(/-[0-9a-f]{6}$/, "");
    copyText("![" + alt + "](" + currentDetail.url + ")", "Markdown");
  });
  document.getElementById("fmRename").addEventListener("click", function () {
    if (!currentDetail) return;
    var key = currentDetail.key;
    var name = key.split("/").pop();
    var next = window.prompt("New file name:", name);
    if (next == null) return;
    next = next.trim();
    if (!next || next === name) return;
    if (next.indexOf("/") !== -1 || next.charAt(0) === ".") {
      toast("Invalid file name");
      return;
    }
    fetch("/upload/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: key, to: parentOf(key) + next })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        toast("Renamed");
        detail.close();
        reload();
      })
      .catch(function () { toast("Rename failed"); });
  });
  document.getElementById("fmMove").addEventListener("click", function () {
    if (!currentDetail) return;
    var target = window.prompt("Move to folder (img/…):", cwd);
    if (target == null) return;
    target = target.trim();
    if (target.indexOf(".") !== -1 && !/\\.[a-z0-9]+$/i.test(target)) {
      // looks like a typo; the server validates anyway
    }
    fetch("/upload/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: currentDetail.key, to: target })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        toast("Moved");
        detail.close();
        reload();
      })
      .catch(function () { toast("Move failed"); });
  });
  document.getElementById("fmDelete").addEventListener("click", function () {
    if (currentDetail) deleteFile(currentDetail);
  });
  document.getElementById("fmClose").addEventListener("click", function () { detail.close(); });

  // --- uploading ------------------------------------------------------------

  function urlField(url) {
    var input = document.createElement("input");
    input.className = "url";
    input.readOnly = true;
    input.value = url;
    input.setAttribute("aria-label", "Image URL");
    input.addEventListener("click", function () { input.select(); });
    return input;
  }

  function actionButtons(key, url, alt) {
    var markdown = "![" + alt + "](" + url + ")";
    var wrap = document.createElement("div");
    wrap.className = "actions";
    var copyUrl = document.createElement("button");
    copyUrl.type = "button";
    copyUrl.textContent = "Copy URL";
    copyUrl.addEventListener("click", function () { copyText(url, "URL"); });
    var copyMd = document.createElement("button");
    copyMd.type = "button";
    copyMd.textContent = "Copy Markdown";
    copyMd.addEventListener("click", function () { copyText(markdown, "Markdown"); });
    wrap.appendChild(copyUrl);
    wrap.appendChild(copyMd);
    if (key) {
      var del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        if (!window.confirm("Delete " + key + " from R2? This cannot be undone.")) return;
        fetch("/upload?key=" + encodeURIComponent(key), { method: "DELETE" })
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            toast("Deleted");
            reload();
          })
          .catch(function () { toast("Delete failed"); });
      });
      wrap.appendChild(del);
    }
    return wrap;
  }

  function uploadOne(file, rowStatus) {
    var form = new FormData();
    form.append("files", file, file.name);
    // Uploads land in the folder being viewed; the server decides the layout
    // (root -> img/YYYY/MM/, a real folder -> straight into it).
    if (!recentMode && cwd !== "img/") form.append("dir", cwd);
    rowStatus.textContent = "Uploading…";
    rowStatus.className = "status";
    return fetch("/upload", { method: "POST", body: form })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok || !r.data.uploaded || !r.data.uploaded.length) {
          var msg = (r.data && r.data.error) || (r.data && r.data.failed && r.data.failed.join("; ")) || "Upload failed";
          rowStatus.textContent = msg;
          rowStatus.className = "status err";
          return null;
        }
        var item = r.data.uploaded[0];
        rowStatus.textContent = "Uploaded ✓";
        rowStatus.className = "status ok";
        return item;
      })
      .catch(function () {
        rowStatus.textContent = "Network error";
        rowStatus.className = "status err";
        return null;
      });
  }

  function uploadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    queueSection.hidden = false;

    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        var li = document.createElement("li");
        var main = document.createElement("div");
        main.className = "row-main";
        var name = document.createElement("span");
        name.className = "name";
        name.textContent = file.name;
        var size = document.createElement("span");
        size.className = "meta";
        size.textContent = fmtBytes(file.size);
        var status = document.createElement("span");
        status.className = "status";
        status.textContent = "Queued…";
        main.appendChild(name);
        main.appendChild(size);
        main.appendChild(status);
        li.appendChild(main);
        queueEl.insertBefore(li, queueEl.firstChild);

        if (file.size > MAX_BYTES) {
          status.textContent = "Too large (>25MB)";
          status.className = "status err";
          return;
        }

        return uploadOne(file, status).then(function (item) {
          if (!item) return;
          var alt = file.name.replace(/\\.[^.]+$/, "");
          li.appendChild(urlField(item.url));
          li.appendChild(actionButtons(item.key, item.url, alt));
          reload();
        });
      });
    });
    chain.then(function () { toast("Upload batch finished"); });
  }

  // --- wiring ----------------------------------------------------------------

  document.getElementById("fmUploadBtn").addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    uploadFiles(fileInput.files);
    fileInput.value = "";
  });
  grid.addEventListener("click", function (e) {
    if (e.target === grid) fileInput.click();
  });
  document.getElementById("fmNewFolder").addEventListener("click", newFolder);
  document.getElementById("fmRecentBtn").addEventListener("click", function () {
    recentMode = true;
    loadRecent();
  });
  sortSel.addEventListener("change", renderGrid);

  ["dragenter", "dragover"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (window.npEditorActive && window.npEditorActive()) return;
      e.preventDefault();
      grid.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (window.npEditorActive && window.npEditorActive()) return;
      e.preventDefault();
      if (ev === "dragleave" && e.relatedTarget) return;
      grid.classList.remove("drag");
    });
  });
  window.addEventListener("drop", function (e) {
    if (window.npEditorActive && window.npEditorActive()) return;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  document.addEventListener("paste", function (e) {
    if (window.npEditorActive && window.npEditorActive()) return;
    if (!e.clipboardData || !e.clipboardData.files) return;
    if (e.clipboardData.files.length) {
      e.preventDefault();
      uploadFiles(e.clipboardData.files);
    }
  });

  loadFolder();
})();
</script>
</body>
</html>`;
