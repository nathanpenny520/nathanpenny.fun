// Self-hosted admin upload page served by GET /admin in comments.js.
// Kept fully self-contained (inline CSS/JS, zero external assets, noindex) so
// the Worker origin stays dependency-free. The whole file is one template
// literal, so the page's own script deliberately avoids backticks and ${}.
export const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>NP · Image Uploader</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --card: #ffffff; --text: #1c2733; --muted: #66707c;
    --line: #e3e7ec; --accent: #3b6ef6; --ok: #1d8a4e; --err: #c93b3b;
    --danger: #b3362f; --row-hover: #f0f4ff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --card: #161c24; --text: #e6ebf2; --muted: #8b96a5;
      --line: #273140; --accent: #6c96ff; --ok: #4cc38a; --err: #ff7a72;
      --danger: #ff7a72; --row-hover: #1c2430;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 32px 16px 80px;
  }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0; }
  .hint { color: var(--muted); margin: 0 0 20px; font-size: 13.5px; }
  #dropzone {
    border: 2px dashed var(--line); border-radius: 12px; background: var(--card);
    padding: 34px 16px; text-align: center; cursor: pointer; transition: border-color .15s, background .15s;
  }
  #dropzone.drag { border-color: var(--accent); background: var(--row-hover); }
  #dropzone p { margin: 0; color: var(--muted); }
  section { margin-top: 26px; }
  .recent-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  button {
    font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--card); color: var(--text); cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.danger:hover { border-color: var(--danger); color: var(--danger); }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; margin-bottom: 8px;
  }
  li:hover { background: var(--row-hover); }
  .row-main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .name { font-weight: 600; word-break: break-all; }
  .meta { color: var(--muted); font-size: 12.5px; }
  .status { font-size: 12.5px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
  .url {
    display: block; width: 100%; margin: 6px 0; padding: 6px 8px; font-size: 12.5px;
    border: 1px solid var(--line); border-radius: 6px; background: var(--bg);
    color: var(--text); font-family: ui-monospace, monospace; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  #toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(8px);
    background: var(--text); color: var(--bg); padding: 8px 16px; border-radius: 8px;
    font-size: 13.5px; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;
    z-index: 10;
  }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .empty { color: var(--muted); font-size: 13.5px; padding: 10px 2px; }
</style>
</head>
<body>
<main>
  <h1>🛸 Image Uploader</h1>
  <p class="hint">Drag &amp; drop, paste (Ctrl/Cmd+V), or click to browse. PNG · JPG · WebP · GIF · AVIF · SVG, up to 25 MB each. Files land under <code>img/YYYY/MM/</code> and are served from storage.nathanpenny.fun.</p>

  <div id="dropzone" role="button" tabindex="0" aria-label="Upload images">
    <p><strong>Drop images here</strong> or click to browse</p>
  </div>
  <input id="fileInput" type="file" multiple hidden
         accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.svg,image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml">

  <section id="queueSection" hidden>
    <div class="recent-head"><h2>Uploading…</h2></div>
    <ul id="queue"></ul>
  </section>

  <section>
    <div class="recent-head">
      <h2>Recent uploads</h2>
      <button id="refreshBtn" type="button">↻ Refresh</button>
    </div>
    <ul id="recentList"></ul>
    <p class="empty" id="recentEmpty" hidden>Nothing uploaded yet.</p>
  </section>
</main>
<div id="toast" role="status" aria-live="polite"></div>

<script>
(function () {
  "use strict";

  var MAX_BYTES = 25 * 1024 * 1024;
  var STORAGE_ORIGIN = "https://storage.nathanpenny.fun/";

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("fileInput");
  var queueEl = document.getElementById("queue");
  var queueSection = document.getElementById("queueSection");
  var recentList = document.getElementById("recentList");
  var recentEmpty = document.getElementById("recentEmpty");
  var toastEl = document.getElementById("toast");

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
            loadRecent();
          })
          .catch(function () { toast("Delete failed"); });
      });
      wrap.appendChild(del);
    }
    return wrap;
  }

  function urlField(url) {
    var input = document.createElement("input");
    input.className = "url";
    input.readOnly = true;
    input.value = url;
    input.setAttribute("aria-label", "Image URL");
    input.addEventListener("click", function () { input.select(); });
    return input;
  }

  function uploadOne(file, rowStatus) {
    var form = new FormData();
    form.append("files", file, file.name);
    rowStatus.textContent = "Uploading…";
    rowStatus.className = "status";
    return fetch("/upload", { method: "POST", body: form })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok || !r.data.uploaded || !r.data.uploaded.length) {
          var msg = (r.data && r.data.error) || "Upload failed";
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
          loadRecent();
        });
      });
    });
    chain.then(function () { toast("Upload batch finished"); });
  }

  function loadRecent() {
    fetch("/upload?list=1")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        recentList.textContent = "";
        var objects = data.objects || [];
        recentEmpty.hidden = objects.length > 0;
        objects.forEach(function (obj) {
          var alt = obj.key.replace(/^img\\/[0-9]{4}\\/[0-9]{2}\\//, "").replace(/\\.[^.]+$/, "").replace(/-[0-9a-f]{6}$/, "");
          var li = document.createElement("li");
          var main = document.createElement("div");
          main.className = "row-main";
          var name = document.createElement("span");
          name.className = "name";
          name.textContent = alt;
          var meta = document.createElement("span");
          meta.className = "meta";
          meta.textContent = fmtBytes(obj.size) + " · " + (obj.uploaded ? new Date(obj.uploaded).toLocaleString() : "");
          main.appendChild(name);
          main.appendChild(meta);
          li.appendChild(main);
          li.appendChild(urlField(obj.url));
          li.appendChild(actionButtons(obj.key, obj.url, alt));
          recentList.appendChild(li);
        });
      })
      .catch(function () { toast("Could not load uploads"); });
  }

  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", function () {
    uploadFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === "dragleave" && e.relatedTarget) return;
      dropzone.classList.remove("drag");
    });
  });
  window.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  document.addEventListener("paste", function (e) {
    if (!e.clipboardData || !e.clipboardData.files) return;
    if (e.clipboardData.files.length) {
      e.preventDefault();
      uploadFiles(e.clipboardData.files);
    }
  });

  document.getElementById("refreshBtn").addEventListener("click", loadRecent);

  loadRecent();
})();
</script>
</body>
</html>`;
