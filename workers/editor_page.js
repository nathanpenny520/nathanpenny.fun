// Editor tab for the /admin page (interpolated into ADMIN_PAGE_HTML by
// admin_page.js). Self-contained fragment: own <style>, markup and IIFE, so
// admin_page.js only grows by the import + interpolation. The page's inline
// script runs inside admin_page's template literal, so — same rule as there —
// it avoids backticks and ${} entirely, and every backslash in page-side
// regex/string escapes is doubled here (\\n -> \n on the page).

export const EDITOR_TAB_HTML = `
<style>
  .tabs { display: flex; gap: 6px; margin: 0 0 18px; }
  .tab { padding: 7px 14px; border-radius: 999px; }
  .tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  #tabEditor .ed-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 0 0 10px; }
  #edSlug {
    flex: 1 1 200px; font: inherit; font-size: 13px; padding: 6px 9px;
    border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text);
  }
  #edSlug:disabled { opacity: .6; }
  #edCat {
    font: inherit; font-size: 13px; padding: 6px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--card); color: var(--text);
  }
  .ed-status { min-height: 18px; font-size: 13px; margin: 0 0 10px; overflow-wrap: anywhere; }
  .ed-status.ok { color: var(--ok); }
  .ed-status.err { color: var(--err); }
  .ed-status a { color: var(--accent); }
  #edListSection ul li { cursor: pointer; }
  #edHelp { margin: 0 0 12px; font-size: 13px; color: var(--muted); }
  #edHelp summary { cursor: pointer; }
  #edHelp ul { margin: 8px 0 0; padding-left: 18px; list-style: disc; }
  #edHelp li { margin-bottom: 4px; }
  #edHelp code {
    font-family: ui-monospace, Menlo, monospace; font-size: 12px;
    background: var(--row-hover); padding: 1px 4px; border-radius: 4px;
  }
  #edContent {
    width: 100%; min-height: 60vh; resize: vertical; padding: 14px;
    border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text);
    font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  #edContent:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
</style>
<section id="tabEditor" hidden>
  <p class="hint">Publishing commits posts/&lt;slug&gt;.md to GitHub main — CI regenerates the live site in about a minute. Cmd/Ctrl+S to publish. Paste or drop images to upload them and insert markdown.</p>
  <div class="ed-toolbar">
    <button id="edNewBtn" type="button">New</button>
    <button id="edListBtn" type="button" aria-expanded="false">Posts</button>
    <input id="edSlug" type="text" placeholder="post-slug (lowercase, digits, hyphens)" autocomplete="off" spellcheck="false" aria-label="Post slug">
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
    <button id="edImgBtn" type="button">Upload image</button>
    <input id="edImgInput" type="file" hidden accept="image/*">
    <button id="edPublishBtn" type="button" class="primary">Publish</button>
    <button id="edDeleteBtn" type="button" class="danger" hidden>Delete</button>
  </div>
  <p id="edStatus" class="ed-status" aria-live="polite"></p>
  <details id="edHelp">
    <summary>Markdown syntax supported by the generator</summary>
    <ul>
      <li>Headings: <code>#</code> to <code>####</code> (rendered one level deeper; the post title comes from frontmatter)</li>
      <li>Inline: <code>**bold**</code>, <code>*italic*</code>, <code>\`code\`</code>, <code>[link](url)</code>, <code>![alt](url)</code> (images get the blog-img class automatically)</li>
      <li>Blocks: <code>- item</code> lists (unordered only), <code>&gt;</code> quotes, <code>---</code> horizontal rule, <code>\`\`\`</code> fenced code</li>
      <li>Raw HTML blocks pass through verbatim — use them for tables, video/audio embeds, images with explicit width/height</li>
      <li>Not supported: ordered (<code>1.</code>) lists, pipe tables, strikethrough — use an HTML <code>&lt;table&gt;</code> for tables</li>
    </ul>
  </details>
  <section id="edListSection" hidden>
    <div class="recent-head">
      <h2>Posts</h2>
      <button id="edListRefresh" type="button">↻ Refresh</button>
    </div>
    <ul id="edList"></ul>
    <p class="empty" id="edListEmpty" hidden>Load failed.</p>
  </section>
  <textarea id="edContent" spellcheck="false" placeholder="Click New to start, or open a post from the list"></textarea>
</section>
<script>
(function () {
  "use strict";

  function init() {
    // Keep in sync with tools/gen_post_pages.py CATEGORIES (editor.js checks
    // the same list server-side; this select only edits the category line).
    var CATEGORIES = ["anime", "life", "tech", "fun", "fiction", "travel", "ai", "sports", "misc"];
    var DRAFT_KEY = "np-ed:new-draft";

    var edSlug = document.getElementById("edSlug");
    var edContent = document.getElementById("edContent");
    var edCat = document.getElementById("edCat");
    var edStatus = document.getElementById("edStatus");
    var edPublishBtn = document.getElementById("edPublishBtn");
    var edDeleteBtn = document.getElementById("edDeleteBtn");
    var edNewBtn = document.getElementById("edNewBtn");
    var edListBtn = document.getElementById("edListBtn");
    var edListSection = document.getElementById("edListSection");
    var edList = document.getElementById("edList");
    var edListEmpty = document.getElementById("edListEmpty");
    var edImgBtn = document.getElementById("edImgBtn");
    var edImgInput = document.getElementById("edImgInput");

    var edSha = null;      // GitHub blob sha of the loaded post (null = creating)
    var editing = false;   // true once a real post is loaded or created
    var dirty = false;

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

    function frontmatterOf(text) {
      if (text.slice(0, 4) !== "---\\n") return null;
      var end = text.indexOf("\\n---\\n", 4);
      if (end === -1) return null;
      var meta = {};
      text.slice(4, end).split("\\n").forEach(function (line) {
        var i = line.indexOf(":");
        if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
      return meta;
    }

    // Client-side mirror of editor.js validatePost (server re-checks anyway).
    function validateLocal(slug, content) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
        return "Invalid slug (lowercase letters, digits, hyphens only)";
      }
      if (content.charCodeAt(0) === 0xfeff) return "Content starts with a BOM — remove it";
      if (content.slice(0, 4) !== "---\\n") return "Must start with frontmatter (--- on the first line)";
      var meta = frontmatterOf(content);
      if (!meta) return "Unclosed frontmatter (missing closing ---)";
      if (!meta.title) return "Frontmatter is missing a title";
      var d = new Date(meta.date + "T00:00:00Z");
      if (!meta.date || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== meta.date) {
        return "date is not a valid YYYY-MM-DD (e.g. 2026-02-30 would fail CI)";
      }
      if (("category" in meta) && meta.category && CATEGORIES.indexOf(meta.category) === -1) {
        return "Unknown category \\"" + meta.category + "\\" — options: " + CATEGORIES.join(" / ");
      }
      return null;
    }

    function newTemplate() {
      var today = new Date().toISOString().slice(0, 10);
      return "---\\ntitle: \\ndate: " + today + "\\ndescription: \\ncategory: misc\\ntags: \\n---\\n\\n";
    }

    function insertAtCursor(text) {
      var start = edContent.selectionStart || 0;
      var end = edContent.selectionEnd || 0;
      edContent.value = edContent.value.slice(0, start) + text + edContent.value.slice(end);
      var pos = start + text.length;
      edContent.setSelectionRange(pos, pos);
      edContent.focus();
    }

    function markDirty() {
      dirty = true;
    }

    function saveNewDraft() {
      try { localStorage.setItem(DRAFT_KEY, edContent.value); } catch (e) { /* private mode etc. */ }
    }

    function clearNewDraft() {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
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
      }).catch(function (err) {
        edListEmpty.hidden = false;
        edListEmpty.textContent = err.message || "Load failed";
      });
    }

    function openPost(slug) {
      setStatus("Loading " + escapeHtml(slug) + " …", "");
      api("/admin/api/post?slug=" + encodeURIComponent(slug)).then(function (r) {
        if (!r.ok) { setStatus(r.data.error || ("HTTP " + r.status), "err"); return; }
        edSlug.value = r.data.slug;
        edSlug.disabled = true;
        edContent.value = r.data.content;
        edSha = r.data.sha;
        editing = true;
        dirty = false;
        edDeleteBtn.hidden = false;
        var meta = frontmatterOf(r.data.content) || {};
        edCat.value = CATEGORIES.indexOf(meta.category) !== -1 ? meta.category : "misc";
        setStatus("Loaded " + escapeHtml(slug), "ok");
      }).catch(function (err) { setStatus(err.message, "err"); });
    }

    // --- actions ----------------------------------------------------------

    edNewBtn.addEventListener("click", function () {
      edSha = null;
      editing = false;
      dirty = false;
      edSlug.disabled = false;
      edSlug.value = "";
      edDeleteBtn.hidden = true;
      edCat.value = "misc";
      edContent.value = newTemplate();
      setStatus("New post — fill in the slug and title, then publish", "");
      var draft = null;
      try { draft = localStorage.getItem(DRAFT_KEY); } catch (e) { /* ignore */ }
      if (draft) {
        edContent.value = draft;
        setStatus("Restored your unpublished draft", "ok");
      }
      edContent.focus();
    });

    edListBtn.addEventListener("click", function () {
      edListSection.hidden = !edListSection.hidden;
      edListBtn.setAttribute("aria-expanded", edListSection.hidden ? "false" : "true");
    });

    document.getElementById("edListRefresh").addEventListener("click", loadList);

    edCat.addEventListener("change", function () {
      var text = edContent.value;
      var end = text.indexOf("\\n---\\n", 4);
      if (text.slice(0, 4) !== "---\\n" || end === -1) return;
      var lines = text.slice(4, end).split("\\n");
      var idx = -1;
      var at = 0;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("category:") === 0) { idx = i; break; }
        if (lines[i].indexOf("date:") === 0) at = i + 1;
      }
      if (idx >= 0) lines[idx] = "category: " + edCat.value;
      else lines.splice(at, 0, "category: " + edCat.value);
      edContent.value = text.slice(0, 4) + lines.join("\\n") + text.slice(end);
      markDirty();
    });

    edPublishBtn.addEventListener("click", publish);

    function publish() {
      var slug = edSlug.value.trim();
      var err = validateLocal(slug, edContent.value);
      if (err) { setStatus(err, "err"); return; }

      var payload = { slug: slug, content: edContent.value };
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
        edContent.value = "";
        edDeleteBtn.hidden = true;
        loadList();
      }).catch(function (e) { setStatus(e.message, "err"); });
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
            markDirty();
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

    document.addEventListener("paste", function (e) {
      if (!edContent || document.getElementById("tabEditor").hidden) return;
      if (!e.clipboardData || !e.clipboardData.files || !e.clipboardData.files.length) return;
      e.preventDefault();
      uploadImages(e.clipboardData.files);
    });

    window.addEventListener("drop", function (e) {
      if (document.getElementById("tabEditor").hidden) return;
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      uploadImages(e.dataTransfer.files);
    });

    // --- textarea niceties -------------------------------------------------

    edContent.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        insertAtCursor("  ");
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        publish();
      }
    });

    edContent.addEventListener("input", function () {
      markDirty();
      if (!editing) saveNewDraft();
    });

    window.addEventListener("beforeunload", function (e) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

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
