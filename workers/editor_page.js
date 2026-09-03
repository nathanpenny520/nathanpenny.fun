// Editor tab for the /admin page (interpolated into ADMIN_PAGE_HTML by
// admin_page.js). Self-contained fragment: own <style>, markup and IIFE, so
// admin_page.js only grows by the import + interpolation. The page's inline
// script runs inside admin_page's template literal, so — same rule as there —
// it avoids backticks and ${} entirely, and every backslash in page-side
// regex/string escapes is doubled here (\\n -> \n on the page).
//
// Layout: post list pinned in a left sidebar, editor (metadata form + markdown
// body + live preview) on the right, so the two never push each other around.
// The body textarea holds markdown ONLY — title/date/category/tags/description
// live in the form and are composed into canonical frontmatter server-side
// (editor.js composePost), which also makes importing a local .md trivial:
// frontmatter is parsed into the form, the rest goes to the textarea.

export const EDITOR_TAB_HTML = `
<style>
  .tabs { display: flex; gap: 6px; margin: 0 0 18px; }
  .tab { padding: 7px 14px; border-radius: 999px; }
  .tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  #tabEditor .ed-layout {
    display: grid; grid-template-columns: 280px minmax(0, 1fr);
    gap: 16px; align-items: start;
  }
  .ed-side {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 10px; min-width: 0;
  }
  .ed-side-head { display: flex; gap: 6px; margin: 0 0 8px; }
  #edSearch {
    flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 5px 9px;
    border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text);
  }
  #edList li { padding: 8px 10px; margin-bottom: 6px; cursor: pointer; }
  #edList li.active { border-color: var(--accent); background: var(--row-hover); }
  .ed-meta { display: grid; gap: 8px; margin: 0 0 10px; }
  .ed-meta-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .ed-meta input, .ed-meta select, .ed-meta textarea {
    font: inherit; font-size: 13px; padding: 6px 9px;
    border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text);
  }
  .ed-meta textarea { resize: vertical; }
  #edTitle { font-size: 15px; font-weight: 600; }
  #edSlug { flex: 1 1 170px; }
  #edSlug:disabled { opacity: .6; }
  #edDesc { width: 100%; }
  #edDescCount { justify-self: end; font-size: 12px; color: var(--muted); margin-top: -4px; }
  #edCat, #edDate { flex: 0 0 auto; }
  .ed-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 0 0 10px; }
  .ed-toolbar .md-btn { min-width: 30px; font-weight: 600; }
  .ed-toolbar .md-btn i { font-size: 12px; }
  .ed-spacer { flex: 1; }
  .ed-side-toggle { display: none; }
  .ed-status { min-height: 18px; font-size: 13px; margin: 10px 0 0; overflow-wrap: anywhere; }
  .ed-status.ok { color: var(--ok); }
  .ed-status.err { color: var(--err); }
  .ed-status a { color: var(--accent); }
  #edHelp { margin: 14px 0 0; font-size: 13px; color: var(--muted); }
  #edHelp summary { cursor: pointer; }
  #edHelp ul { margin: 8px 0 0; padding-left: 18px; list-style: disc; }
  #edHelp li { margin-bottom: 4px; }
  #edHelp code {
    font-family: ui-monospace, Menlo, monospace; font-size: 12px;
    background: var(--row-hover); padding: 1px 4px; border-radius: 4px;
  }
  .ed-panes { display: grid; gap: 12px; align-items: start; }
  .ed-panes.show-preview { grid-template-columns: 1fr 1fr; }
  #edContent {
    width: 100%; height: 54vh; min-height: 320px; resize: vertical; padding: 14px;
    border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text);
    font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  #edContent:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .ed-preview {
    height: 54vh; overflow: auto; padding: 14px 16px;
    border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    font-size: 14px; line-height: 1.65;
  }
  .ed-preview > :first-child { margin-top: 0; }
  .ed-preview h2, .ed-preview h3, .ed-preview h4, .ed-preview h5 { margin: 18px 0 8px; }
  .ed-preview pre {
    background: var(--row-hover); border-radius: 8px; padding: 12px 14px;
    overflow-x: auto; font-size: 12.5px; line-height: 1.55; margin: 12px 0;
  }
  .ed-preview code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--row-hover); padding: 1px 4px; border-radius: 4px; font-size: .9em;
  }
  .ed-preview pre code { background: none; padding: 0; }
  .ed-preview blockquote {
    margin: 12px 0; padding: 4px 14px; border-left: 3px solid var(--accent); color: var(--muted);
  }
  .ed-preview table { border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  .ed-preview th, .ed-preview td { border: 1px solid var(--line); padding: 5px 10px; }
  .ed-preview ul.task-list { list-style: none; padding-left: 6px; }
  .ed-preview img { max-width: 100%; }
  @media (max-width: 1100px) {
    .ed-panes.show-preview { grid-template-columns: 1fr; }
  }
  @media (max-width: 900px) {
    #tabEditor .ed-layout { grid-template-columns: 1fr; }
    .ed-side-toggle { display: inline-block; }
    .ed-side { display: none; }
    .ed-side.open { display: block; margin-bottom: 12px; }
  }
</style>
<section id="tabEditor" hidden>
  <p class="hint">Publishing commits posts/&lt;slug&gt;.md to GitHub main — CI regenerates the live site in about a minute. Cmd/Ctrl+S to publish. Paste or drop images to insert markdown; drop a .md file to import it.</p>
  <div class="ed-layout">
    <aside class="ed-side" id="edSide">
      <div class="ed-side-head">
        <button id="edNewBtn" type="button" class="primary">+ New</button>
        <button id="edListRefresh" type="button" title="Refresh list">↻</button>
      </div>
      <input id="edSearch" type="text" placeholder="Filter by slug…" autocomplete="off" spellcheck="false" aria-label="Filter posts">
      <ul id="edList"></ul>
      <p class="empty" id="edListEmpty" hidden>No posts yet.</p>
    </aside>
    <div class="ed-main">
      <div class="ed-meta">
        <input id="edTitle" type="text" placeholder="Title" autocomplete="off" aria-label="Title">
        <div class="ed-meta-row">
          <input id="edSlug" type="text" placeholder="post-slug (lowercase, digits, hyphens)" autocomplete="off" spellcheck="false" aria-label="Post slug">
          <input id="edDate" type="date" aria-label="Date">
          <select id="edCat" aria-label="Category">
            <option value="anime">anime</option>
            <option value="life">life</option>
            <option value="tech">tech</option>
            <option value="fun">fun</option>
            <option value="fiction">fiction</option>
            <option value="travel">travel</option>
            <option value="ai">ai</option>
            <option value="sports">sports</option>
            <option value="misc">misc</option>
          </select>
        </div>
        <input id="edTags" type="text" placeholder="tags, comma separated (optional)" autocomplete="off" aria-label="Tags">
        <textarea id="edDesc" rows="2" placeholder="Description (optional — falls back to the first paragraph)" aria-label="Description"></textarea>
        <span id="edDescCount" aria-hidden="true"></span>
      </div>
      <div class="ed-toolbar">
        <button id="edSideBtn" type="button" class="ed-side-toggle" aria-expanded="false">☰ Posts</button>
        <button type="button" class="md-btn" data-md="bold" title="Bold (Cmd/Ctrl+B)"><strong>B</strong></button>
        <button type="button" class="md-btn" data-md="italic" title="Italic (Cmd/Ctrl+I)"><em>I</em></button>
        <button type="button" class="md-btn" data-md="code" title="Inline code">&lt;/&gt;</button>
        <button type="button" class="md-btn" data-md="link" title="Link">🔗</button>
        <button type="button" class="md-btn" data-md="image" title="Image">🖼</button>
        <button type="button" class="md-btn" data-md="ul" title="Bullet list">••</button>
        <button type="button" class="md-btn" data-md="ol" title="Numbered list">1.</button>
        <button type="button" class="md-btn" data-md="task" title="Task list">☑</button>
        <button type="button" class="md-btn" data-md="quote" title="Quote">❝</button>
        <button type="button" class="md-btn" data-md="fence" title="Code block">{ }</button>
        <button type="button" class="md-btn" data-md="table" title="Table">▦</button>
        <button type="button" class="md-btn" data-md="del" title="Strikethrough"><del>S</del></button>
        <span class="ed-spacer"></span>
        <button id="edImportBtn" type="button" title="Load a local .md file">Import .md</button>
        <input id="edImportInput" type="file" hidden accept=".md,text/markdown">
        <button id="edPreviewBtn" type="button" aria-pressed="false">Preview</button>
        <button id="edImgBtn" type="button" title="Upload an image and insert markdown">Upload image</button>
        <input id="edImgInput" type="file" hidden accept="image/*">
        <button id="edPublishBtn" type="button" class="primary">Publish</button>
        <button id="edDeleteBtn" type="button" class="danger" hidden>Delete</button>
      </div>
      <div class="ed-panes" id="edPanes">
        <textarea id="edContent" spellcheck="false" placeholder="Write markdown here — syntax cheat sheet below"></textarea>
        <div id="edPreview" class="ed-preview" hidden aria-label="Preview"></div>
      </div>
      <p id="edStatus" class="ed-status" aria-live="polite"></p>
    </div>
  </div>
  <details id="edHelp">
    <summary>Markdown syntax supported by the generator</summary>
    <ul>
      <li>Headings: <code>#</code> to <code>####</code> (rendered one level deeper; the post title comes from the form above)</li>
      <li>Inline: <code>**bold**</code>, <code>*italic*</code>, <code>~~strikethrough~~</code>, <code>\`code\`</code>, <code>[link](url)</code>, <code>![alt](url)</code> (images get the blog-img class), autolinks <code>&lt;https://…&gt;</code></li>
      <li>Lists: <code>- item</code> / <code>* item</code>, ordered <code>1. item</code>, nesting by indentation; task lists <code>- [ ]</code> / <code>- [x]</code></li>
      <li>Tables: pipe rows with a <code>|---|---|</code> separator; alignment via <code>:---</code>, <code>:---:</code>, <code>---:</code> (a <code>|</code> inside a cell needs backticks or an HTML block)</li>
      <li>Blocks: <code>&gt;</code> quotes, <code>---</code> horizontal rule, <code>\`\`\`lang</code> fenced code (highlighted on the live page: js, python, bash, css, html, json, …)</li>
      <li>Raw HTML blocks pass through verbatim — use them for video/audio embeds, images with explicit width/height</li>
      <li>Not supported: footnotes, math/LaTeX, multi-line list items, loose (blank-line separated) lists</li>
    </ul>
  </details>
</section>
<script>
(function () {
  "use strict";

  function init() {
    // Keep in sync with tools/gen_post_pages.py CATEGORIES (editor.js checks
    // the same list server-side; this select only feeds the form).
    var CATEGORIES = ["anime", "life", "tech", "fun", "fiction", "travel", "ai", "sports", "misc"];
    var DRAFT_KEY = "np-ed:new-draft";

    var edSide = document.getElementById("edSide");
    var edSideBtn = document.getElementById("edSideBtn");
    var edSearch = document.getElementById("edSearch");
    var edTitle = document.getElementById("edTitle");
    var edSlug = document.getElementById("edSlug");
    var edDate = document.getElementById("edDate");
    var edCat = document.getElementById("edCat");
    var edTags = document.getElementById("edTags");
    var edDesc = document.getElementById("edDesc");
    var edDescCount = document.getElementById("edDescCount");
    var edContent = document.getElementById("edContent");
    var edPreview = document.getElementById("edPreview");
    var edPanes = document.getElementById("edPanes");
    var edPreviewBtn = document.getElementById("edPreviewBtn");
    var edStatus = document.getElementById("edStatus");
    var edPublishBtn = document.getElementById("edPublishBtn");
    var edDeleteBtn = document.getElementById("edDeleteBtn");
    var edNewBtn = document.getElementById("edNewBtn");
    var edList = document.getElementById("edList");
    var edListEmpty = document.getElementById("edListEmpty");
    var edImgBtn = document.getElementById("edImgBtn");
    var edImgInput = document.getElementById("edImgInput");
    var edImportBtn = document.getElementById("edImportBtn");
    var edImportInput = document.getElementById("edImportInput");

    var edSha = null;      // GitHub blob sha of the loaded post (null = creating)
    var editing = false;   // true once a real post is loaded or created
    var dirty = false;
    var previewOn = false;
    var previewTimer = null;

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

    var toastEl = null;
    var toastTimer = null;
    function toast(msg) {
      if (!toastEl) toastEl = document.getElementById("toast");
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
    }

    function setStatus(html, cls) {
      edStatus.innerHTML = html;
      edStatus.className = "ed-status" + (cls ? " " + cls : "");
    }

    // fetch wrapper that fails loudly when the Access session expired (the
    // edge answers with the login page HTML instead of our JSON).
    function api(path, opts) {
      return fetch(path, opts).then(function (res) {
        var ct = res.headers.get("content-type") || "";
        if (ct.indexOf("application/json") === -1) {
          var err = new Error("Access session expired — refresh the page to sign in again");
          err.session = true;
          throw err;
        }
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      });
    }

    // Split a full post document into {meta, body} — mirror of the
    // generator's naive frontmatter parser (key: value per line).
    function parseDoc(text) {
      if (typeof text !== "string" || text.slice(0, 4) !== "---\\n") return { meta: {}, body: text || "" };
      var end = text.indexOf("\\n---\\n", 4);
      if (end === -1) return { meta: {}, body: text };
      var meta = {};
      text.slice(4, end).split("\\n").forEach(function (line) {
        var i = line.indexOf(":");
        if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
      return { meta: meta, body: text.slice(end + 5).replace(/^\\n+/, "") };
    }

    // Client-side mirror of editor.js checks (server re-checks anyway).
    function validateLocal(slug, meta) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
        return "Invalid slug (lowercase letters, digits, hyphens only)";
      }
      if (!meta.title.trim()) return "Title is required";
      var d = meta.date;
      var parsed = new Date(d + "T00:00:00Z");
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(d) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) {
        return "Date must be a valid YYYY-MM-DD";
      }
      return null;
    }

    function readMeta() {
      return {
        title: edTitle.value,
        date: edDate.value,
        category: edCat.value,
        tags: edTags.value,
        description: edDesc.value
      };
    }

    // Local (not UTC) date so an evening post in UTC+8 is not dated yesterday.
    function todayLocal() {
      var d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function fillForm(meta) {
      edTitle.value = meta.title || "";
      var d = meta.date;
      edDate.value = /^\\d{4}-\\d{2}-\\d{2}$/.test(d || "") ? d : todayLocal();
      edCat.value = CATEGORIES.indexOf(meta.category) !== -1 ? meta.category : "misc";
      edTags.value = meta.tags || "";
      edDesc.value = meta.description || "";
      updateDescCount();
    }

    function newTemplate() {
      return "";
    }

    function updateDescCount() {
      var n = edDesc.value.trim().length;
      edDescCount.textContent = n ? n + " / 165 chars" : "";
    }

    function insertAtCursor(text) {
      var start = edContent.selectionStart || 0;
      var end = edContent.selectionEnd || 0;
      edContent.value = edContent.value.slice(0, start) + text + edContent.value.slice(end);
      var pos = start + text.length;
      edContent.setSelectionRange(pos, pos);
      edContent.focus();
      markDirty();
    }

    function wrapSelection(before, after) {
      var start = edContent.selectionStart || 0;
      var end = edContent.selectionEnd || 0;
      var sel = edContent.value.slice(start, end);
      edContent.value = edContent.value.slice(0, start) + before + sel + after + edContent.value.slice(end);
      edContent.setSelectionRange(start + before.length, end + before.length);
      edContent.focus();
      markDirty();
    }

    function markDirty() {
      dirty = true;
    }

    function saveNewDraft() {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ meta: readMeta(), body: edContent.value }));
      } catch (e) { /* private mode etc. */ }
    }

    function clearNewDraft() {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    }

    function confirmDiscard() {
      if (!dirty) return true;
      if (window.confirm("Discard unsaved changes?")) { dirty = false; return true; }
      return false;
    }

    // --- live preview -----------------------------------------------------
    // Faithful JS port of tools/gen_post_pages.py render_markdown so the
    // pane shows what CI will generate (the generated page stays the truth).

    var BLOCK_START = /^(<|\`\`\`|#{1,4}\\s|>\\s?|[-*]\\s+|\\d{1,9}[.)]\\s+|\\||---\\s*$)/;
    var LIST_ITEM_RE = /^(\\s*)([-*]|\\d{1,9}[.)])\\s+(.*)$/;
    var TASK_RE = /^\\[( |x|X)\\]\\s+(.*)$/;
    var TABLE_DELIM_RE = /^:?-{3,}:?$/;

    function renderInline(text) {
      var parts = text.split(/(\`[^\`]+\`)/);
      var out = [];
      for (var k = 0; k < parts.length; k++) {
        var p = parts[k];
        if (p.length > 2 && p.charAt(0) === "\`" && p.charAt(p.length - 1) === "\`") {
          out.push("<code>" + escapeHtml(p.slice(1, -1)) + "</code>");
          continue;
        }
        var s = p;
        s = s.replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)/g,
          '<img class="blog-img" src="$2" alt="$1" loading="lazy" decoding="async">');
        s = s.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, '<a href="$2">$1</a>');
        s = s.replace(/<(https?:\\/\\/[^>\\s]+)>/g, '<a href="$1">$1</a>');
        s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
        s = s.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
        s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
        out.push(s);
      }
      return out.join("");
    }

    function tableCells(line) {
      line = line.trim();
      if (line.charAt(0) === "|") line = line.slice(1);
      if (line.charAt(line.length - 1) === "|") line = line.slice(0, -1);
      var cells = [];
      var buf = "";
      var inCode = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (ch === "\`") { inCode = !inCode; buf += ch; }
        else if (ch === "|" && !inCode) { cells.push(buf.trim()); buf = ""; }
        else buf += ch;
      }
      cells.push(buf.trim());
      return cells;
    }

    function isDelimiterRow(line) {
      var cells = tableCells(line);
      if (!cells.length) return false;
      for (var i = 0; i < cells.length; i++) {
        if (!TABLE_DELIM_RE.test(cells[i])) return false;
      }
      return true;
    }

    function alignAttr(cell) {
      var left = cell.charAt(0) === ":";
      var right = cell.charAt(cell.length - 1) === ":";
      if (left && right) return ' style="text-align:center"';
      if (right) return ' style="text-align:right"';
      if (left) return ' style="text-align:left"';
      return "";
    }

    function renderList(lines, i, indent) {
      var ordered = LIST_ITEM_RE.test(lines[i]) && /\\d/.test(LIST_ITEM_RE.exec(lines[i])[2]);
      var items = [];
      var hasTask = false;
      while (i < lines.length) {
        var m = LIST_ITEM_RE.exec(lines[i]);
        if (!m || m[1].length < indent) break;
        if (m[1].length > indent) {
          var nested = renderList(lines, i, m[1].length);
          if (items.length) items[items.length - 1] += "\\n" + nested.html;
          else items.push(nested.html);
          i = nested.i;
          continue;
        }
        var text = m[3].trim();
        var task = TASK_RE.exec(text);
        if (task) {
          hasTask = true;
          var checked = task[1].toLowerCase() === "x" ? " checked" : "";
          items.push('  <li><input type="checkbox" disabled' + checked + "> " + renderInline(task[2]) + "</li>");
        } else {
          items.push("  <li>" + renderInline(text) + "</li>");
        }
        i += 1;
      }
      var tag = ordered ? "ol" : "ul";
      var cls = hasTask ? ' class="task-list"' : "";
      var html = "<" + tag + cls + ">\\n" + items.join("\\n") + "\\n</" + tag + ">";
      return { html: html, i: i };
    }

    function renderTable(lines, i) {
      var head = tableCells(lines[i]);
      var aligns = tableCells(lines[i + 1]).map(alignAttr);
      i += 2;
      var rows = [];
      while (i < lines.length && lines[i].trim().charAt(0) === "|") {
        var cells = tableCells(lines[i]);
        while (cells.length < head.length) cells.push("");
        rows.push(cells.slice(0, head.length));
        i += 1;
      }
      function rowHtml(tag, cells) {
        var out = "    <tr>";
        for (var j = 0; j < cells.length; j++) {
          out += "<" + tag + (j < aligns.length ? aligns[j] : "") + ">" + renderInline(cells[j]) + "</" + tag + ">";
        }
        return out + "</tr>";
      }
      var body = rows.length ? "\\n" + rows.map(function (r) { return rowHtml("td", r); }).join("\\n") + "\\n" : "\\n";
      return { html: "<table>\\n  <thead>\\n" + rowHtml("th", head) + "\\n  </thead>\\n  <tbody>" + body + "  </tbody>\\n</table>", i: i };
    }

    function mdToHtml(src) {
      var lines = src.split("\\n");
      var out = [];
      var i = 0;
      while (i < lines.length) {
        var stripped = lines[i].trim();
        if (!stripped) { i += 1; continue; }

        if (stripped.indexOf("\`\`\`") === 0) {
          var m = /^\`\`\`([^\\s\`]+)/.exec(stripped);
          var lang = m ? m[1] : "";
          var cls = /^[a-zA-Z0-9_+-]+$/.test(lang) ? ' class="language-' + lang + '"' : "";
          var code = [];
          i += 1;
          while (i < lines.length && lines[i].trim().indexOf("\`\`\`") !== 0) {
            code.push(lines[i]);
            i += 1;
          }
          i += 1; // closing fence
          out.push("<pre><code" + cls + ">" + escapeHtml(code.join("\\n")) + "</code></pre>");
          continue;
        }

        var hm = /^(#{1,4})\\s+(.*)$/.exec(stripped);
        if (hm) {
          var lvl = hm[1].length + 1;
          out.push("<h" + lvl + ">" + renderInline(hm[2]) + "</h" + lvl + ">");
          i += 1;
          continue;
        }

        if (stripped === "---") { out.push("<hr>"); i += 1; continue; }

        if (stripped.charAt(0) === ">") {
          var quote = [];
          while (i < lines.length && lines[i].trim().charAt(0) === ">") {
            quote.push(lines[i].replace(/^\\s*>\\s?/, ""));
            i += 1;
          }
          out.push("<blockquote>\\n  <p>" + renderInline(quote.join(" ").trim()) + "</p>\\n</blockquote>");
          continue;
        }

        if (/^[-*]\\s+/.test(stripped) || /^\\d{1,9}[.)]\\s+/.test(stripped)) {
          var parsed = renderList(lines, i, lines[i].length - lines[i].replace(/^\\s+/, "").length);
          out.push(parsed.html);
          i = parsed.i;
          continue;
        }

        if (stripped.charAt(0) === "|" && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
          var t = renderTable(lines, i);
          out.push(t.html);
          i = t.i;
          continue;
        }

        if (stripped.charAt(0) === "<") {
          var block = [];
          while (i < lines.length && lines[i].trim()) {
            block.push(lines[i].replace(/\\s+$/, ""));
            i += 1;
          }
          out.push(block.join("\\n"));
          continue;
        }

        var para = [];
        while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i].trim())) {
          para.push(lines[i].trim());
          i += 1;
        }
        if (!para.length) { para.push(lines[i].trim()); i += 1; }
        out.push("<p>" + renderInline(para.join(" ")) + "</p>");
      }
      return out.join("\\n");
    }

    function renderPreview() {
      if (!previewOn) return;
      edPreview.innerHTML = mdToHtml(edContent.value);
    }

    function setPreview(on) {
      previewOn = on;
      edPreviewBtn.setAttribute("aria-pressed", on ? "true" : "false");
      edPanes.classList.toggle("show-preview", on);
      edPreview.hidden = !on;
      if (on) renderPreview();
    }

    // --- post list --------------------------------------------------------

    function loadList() {
      api("/admin/api/posts").then(function (r) {
        if (!r.ok) {
          edListEmpty.hidden = false;
          edListEmpty.textContent = r.data.error || ("HTTP " + r.status);
          return;
        }
        var posts = r.data.posts || [];
        edList.textContent = "";
        edListEmpty.hidden = posts.length > 0;
        if (!posts.length) edListEmpty.textContent = "No posts yet.";
        posts.forEach(function (p) {
          var li = document.createElement("li");
          li.dataset.slug = p.slug;
          if (p.slug === edSlug.value && editing) li.classList.add("active");
          var main = document.createElement("div");
          main.className = "row-main";
          var name = document.createElement("span");
          name.className = "name";
          name.textContent = p.slug;
          var meta = document.createElement("span");
          meta.className = "meta";
          meta.textContent = fmtBytes(p.size);
          main.appendChild(name);
          main.appendChild(meta);
          li.appendChild(main);
          li.addEventListener("click", function () { openPost(p.slug); });
          edList.appendChild(li);
        });
        filterList();
      }).catch(function (err) {
        edListEmpty.hidden = false;
        edListEmpty.textContent = err.message || "Load failed";
      });
    }

    function filterList() {
      var q = edSearch.value.trim().toLowerCase();
      var items = edList.querySelectorAll("li");
      for (var i = 0; i < items.length; i++) {
        var slug = (items[i].dataset.slug || "").toLowerCase();
        items[i].hidden = q !== "" && slug.indexOf(q) === -1;
      }
    }

    function openPost(slug) {
      if (!confirmDiscard()) return;
      setStatus("Loading " + escapeHtml(slug) + " …", "");
      api("/admin/api/post?slug=" + encodeURIComponent(slug)).then(function (r) {
        if (!r.ok) { setStatus(r.data.error || ("HTTP " + r.status), "err"); return; }
        var doc = parseDoc(r.data.content);
        edSlug.value = r.data.slug;
        edSlug.disabled = true;
        fillForm(doc.meta);
        edContent.value = doc.body;
        edSha = r.data.sha;
        editing = true;
        dirty = false;
        edDeleteBtn.hidden = false;
        setActiveListRow(slug);
        setStatus("Loaded " + escapeHtml(slug), "ok");
        renderPreview();
      }).catch(function (err) { setStatus(err.message, "err"); });
    }

    function setActiveListRow(slug) {
      var items = edList.querySelectorAll("li");
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle("active", items[i].dataset.slug === slug);
      }
    }

    // --- local .md import ---------------------------------------------------

    function importMarkdownFile(file) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
        var doc = parseDoc(text);
        fillForm(doc.meta);
        edContent.value = doc.body;
        edSha = null;
        editing = false;
        dirty = false;
        edSlug.disabled = false;
        edSlug.value = "";
        edDeleteBtn.hidden = true;
        setActiveListRow(null);
        // Suggest a slug from the filename stem when the frontmatter has none.
        var stem = file.name.replace(/\\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
        if (!doc.meta.slug && stem) edSlug.value = stem;
        markDirty();
        setStatus("Imported " + escapeHtml(file.name) + (doc.meta.title ? "" : " — no frontmatter found, fill in the form") + ". Set the slug and publish.", "ok");
        toast("Imported " + file.name);
        renderPreview();
      };
      reader.onerror = function () { setStatus("Could not read " + escapeHtml(file.name), "err"); };
      reader.readAsText(file);
    }

    // --- actions ----------------------------------------------------------

    edNewBtn.addEventListener("click", function () {
      if (!confirmDiscard()) return;
      edSha = null;
      editing = false;
      dirty = false;
      edSlug.disabled = false;
      edSlug.value = "";
      edDeleteBtn.hidden = true;
      fillForm({});
      edContent.value = newTemplate();
      setActiveListRow(null);
      setStatus("New post — fill in the form, write markdown, then publish", "");
      var draft = null;
      try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { /* ignore */ }
      if (draft && typeof draft.body === "string" && (draft.body || draft.meta && draft.meta.title)) {
        fillForm(draft.meta || {});
        edContent.value = draft.body;
        setStatus("Restored your unpublished draft", "ok");
      }
      edContent.focus();
      renderPreview();
    });

    edSideBtn.addEventListener("click", function () {
      var open = edSide.classList.toggle("open");
      edSideBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    edSearch.addEventListener("input", filterList);

    document.getElementById("edListRefresh").addEventListener("click", loadList);

    edPublishBtn.addEventListener("click", publish);

    function publish() {
      var slug = edSlug.value.trim();
      var meta = readMeta();
      var err = validateLocal(slug, meta);
      if (err) { setStatus(err, "err"); return; }

      var payload = { slug: slug, meta: meta, body: edContent.value };
      if (edSha) payload.sha = edSha;
      edPublishBtn.disabled = true;
      setStatus(edSha ? "Updating…" : "Publishing…", "");

      api("/admin/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) {
        edPublishBtn.disabled = false;
        if (!r.ok) {
          setStatus(r.data.error || ("HTTP " + r.status), "err");
          if (r.status === 409) toast("Changed remotely — reload the post");
          return;
        }
        edSha = r.data.sha;
        editing = true;
        dirty = false;
        edSlug.disabled = true;
        edDeleteBtn.hidden = false;
        clearNewDraft();
        setActiveListRow(slug);
        var live = "https://nathanpenny.fun/blog/" + encodeURIComponent(slug) + "/";
        var html = (r.data.created ? "Created " : "Updated ") + escapeHtml(slug) +
          " — live in ~1 minute (CI): <a target='_blank' rel='noopener' href='" + live + "'>" + escapeHtml(slug) + "</a>";
        if (r.data.commit_url) {
          html += " · <a target='_blank' rel='noopener' href='" + escapeHtml(r.data.commit_url) + "'>commit</a>";
        }
        setStatus(html, "ok");
        toast("Published — live in ~1 minute");
        loadList();
      }).catch(function (e) {
        edPublishBtn.disabled = false;
        setStatus(e.message || "Network error", "err");
      });
    }

    edDeleteBtn.addEventListener("click", function () {
      if (!editing || !edSha) return;
      var slug = edSlug.value;
      if (!window.confirm("Delete " + slug + "? CI will remove the live page and the list entry (recoverable from git history).")) return;
      api("/admin/api/post?slug=" + encodeURIComponent(slug) + "&sha=" + encodeURIComponent(edSha), {
        method: "DELETE"
      }).then(function (r) {
        if (!r.ok) { setStatus(r.data.error || ("HTTP " + r.status), "err"); return; }
        toast("Deleted");
        setStatus("Deleted " + escapeHtml(slug), "ok");
        edSha = null;
        editing = false;
        dirty = false;
        edSlug.disabled = false;
        edSlug.value = "";
        fillForm({});
        edContent.value = "";
        edDeleteBtn.hidden = true;
        setActiveListRow(null);
        loadList();
      }).catch(function (e) { setStatus(e.message, "err"); });
    });

    // --- markdown toolbar ---------------------------------------------------

    var SNIPPETS = {
      bold: null, italic: null, code: null, del: null, // wrap-selection buttons
      link: "[text](https://)",
      image: "![alt](url)\\n\\n",
      ul: "\\n- item\\n",
      ol: "\\n1. item\\n",
      task: "\\n- [ ] todo\\n",
      quote: "\\n> quote\\n",
      fence: "\\n\`\`\`js\\n\\n\`\`\`\\n\\n",
      table: "\\n| A | B |\\n| --- | --- |\\n| a | b |\\n\\n"
    };
    var WRAPS = { bold: ["**", "**"], italic: ["*", "*"], code: ["\`", "\`"], del: ["~~", "~~"] };

    document.querySelectorAll("#tabEditor .md-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var kind = btn.getAttribute("data-md");
        if (WRAPS[kind]) { wrapSelection(WRAPS[kind][0], WRAPS[kind][1]); return; }
        if (SNIPPETS[kind]) insertAtCursor(SNIPPETS[kind]);
      });
    });

    // --- images: upload to the existing /upload endpoint, insert markdown --

    function uploadImages(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      files.forEach(function (file) {
        if (file.size > 25 * 1024 * 1024) {
          setStatus("Image too large (>25MB): " + escapeHtml(file.name), "err");
          return;
        }
        setStatus("Uploading image: " + escapeHtml(file.name), "");
        var form = new FormData();
        form.append("files", file, file.name);
        fetch("/upload", { method: "POST", body: form })
          .then(function (res) {
            return res.json().then(function (data) { return { ok: res.ok, data: data }; });
          })
          .then(function (r) {
            if (!r.ok || !r.data.uploaded || !r.data.uploaded.length) {
              throw new Error((r.data && r.data.error) || "Upload failed");
            }
            var item = r.data.uploaded[0];
            var alt = file.name.replace(/\\.[^.]+$/, "");
            insertAtCursor("![" + alt + "](" + item.url + ")\\n\\n");
            setStatus("Inserted image " + escapeHtml(item.url), "ok");
            toast("Image inserted");
          })
          .catch(function (e) { setStatus(e.message || "Upload failed", "err"); });
      });
    }

    edImgBtn.addEventListener("click", function () { edImgInput.click(); });
    edImgInput.addEventListener("change", function () {
      uploadImages(edImgInput.files);
      edImgInput.value = "";
    });

    // One drop handler: .md files import, images upload + insert.
    function handleFiles(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      var md = null;
      var images = files.filter(function (f) {
        if (/\\.md$/i.test(f.name) && !md) { md = f; return false; }
        return true;
      });
      if (md) importMarkdownFile(md);
      if (images.length) uploadImages(images);
    }

    document.addEventListener("paste", function (e) {
      if (!edContent || document.getElementById("tabEditor").hidden) return;
      if (!e.clipboardData || !e.clipboardData.files || !e.clipboardData.files.length) return;
      e.preventDefault();
      handleFiles(e.clipboardData.files);
    });

    window.addEventListener("drop", function (e) {
      if (document.getElementById("tabEditor").hidden) return;
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    });

    edImportBtn.addEventListener("click", function () { edImportInput.click(); });
    edImportInput.addEventListener("change", function () {
      if (edImportInput.files.length && confirmDiscard()) importMarkdownFile(edImportInput.files[0]);
      edImportInput.value = "";
    });

    // --- textarea niceties -------------------------------------------------

    edContent.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        insertAtCursor("  ");
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "s" || e.key === "S") { e.preventDefault(); publish(); return; }
        if (e.key === "b" || e.key === "B") { e.preventDefault(); wrapSelection("**", "**"); return; }
        if (e.key === "i" || e.key === "I") { e.preventDefault(); wrapSelection("*", "*"); }
      }
    });

    edContent.addEventListener("input", function () {
      markDirty();
      if (!editing) saveNewDraft();
      if (previewOn) {
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreview, 250);
      }
    });

    edDesc.addEventListener("input", updateDescCount);

    edPreviewBtn.addEventListener("click", function () { setPreview(!previewOn); });

    window.addEventListener("beforeunload", function (e) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    fillForm({}); // sets today's date as the default
    loadList();
  }

  // This script sits inside <main>, before the shared #toast element, so wait
  // for the DOM to settle before grabbing anything.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>`;
