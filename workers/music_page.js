// Music tab for the /admin page (interpolated into ADMIN_PAGE_HTML by
// admin_page.js): a browser-side replacement for the old local pipeline —
// drag artist/album folders straight into R2's music/ prefix, then Sync
// rebuilds data/music-library.json from a full R2 listing (with an iTunes
// cover lookup for new songs) and commits it via /admin/api/music/* (see
// music.js). Covers loop one song per request so a big sync stays far below
// the Worker subrequest limits and resumes where it stopped. Self-contained
// fragment: own <style>, markup and IIFE, like the other tabs. The page's
// inline script runs inside admin_page's template literal, so — same rule as
// there — it avoids backticks and ${} entirely, and this one also stays
// backslash-free (no regex escapes needed) so the eaten-backslash trap
// cannot bite at all.

export const MUSIC_TAB_HTML = `
<style>
  #tabMusic .mu-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 14px; }
  #tabMusic .mu-badge {
    font-size: 11px; padding: 1px 8px; border-radius: 999px; flex-shrink: 0;
    background: var(--color-surface-alt); border: 1px solid var(--color-border); color: var(--color-text-muted);
  }
  #tabMusic .mu-badge.warn { background: #fff7ed; border-color: #f0c987; color: #9a6b1f; }
  :root[data-theme="dark"] #tabMusic .mu-badge.warn,
  :root:not([data-theme="light"]) #tabMusic .mu-badge.warn { background: #3a2f1b; border-color: #6b5426; color: #e0b45e; }
  #muDrop {
    border: 2px dashed var(--color-border); border-radius: 12px; padding: 18px 16px; text-align: center;
    color: var(--color-text-muted); font-size: 13.5px; background: var(--color-surface); margin: 0 0 18px;
  }
  #muDrop.drag { border-color: var(--color-accent); background: var(--color-surface-alt); color: var(--color-text); }
  #muDrop .mu-dropbtns { display: flex; gap: 8px; justify-content: center; margin-top: 10px; flex-wrap: wrap; }
  #tabMusic .mu-group {
    background: none; border: none; border-radius: 0; padding: 10px 2px 2px; margin: 8px 0 2px;
    font-weight: 600; color: var(--color-heading); font-size: 13.5px;
  }
  #tabMusic .mu-group:hover { background: none; }
  #tabMusic .mu-song { display: flex; gap: 10px; align-items: center; }
  #tabMusic .mu-cover {
    width: 44px; height: 44px; border-radius: 6px; object-fit: cover; flex-shrink: 0;
    background: var(--color-surface-alt); display: flex; align-items: center; justify-content: center;
    font-size: 20px; color: var(--color-text-muted);
  }
  #tabMusic .mu-songbody { min-width: 0; flex: 1; }
  #tabMusic .mu-title { font-weight: 600; font-size: 13.5px; word-break: break-all; }
  #tabMusic .mu-meta { color: var(--color-text-muted); font-size: 12px; word-break: break-all; }
  #tabMusic .mu-pending { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  #tabMusic .mu-pending .name { flex-basis: 100%; }
  #tabMusic .mu-pinput {
    font: inherit; font-size: 12.5px; padding: 4px 6px; border: 1px solid var(--color-border);
    border-radius: 6px; background: var(--color-surface); color: var(--color-text); flex: 1 1 140px; min-width: 0;
  }
  #muSyncBox {
    border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface);
    padding: 12px 14px; margin: 0 0 14px; font-size: 13.5px;
  }
  #muSyncBox ul { margin: 8px 0 0; }
  #muSyncBox li { padding: 4px 10px; font-size: 12.5px; margin-bottom: 4px; }
</style>
<section id="tabMusic" hidden>
  <p class="hint">The Creations music library: audio lives in the R2 bucket's <code>music/Artist/Album/</code> prefix (served by storage.nathanpenny.fun, never in the repo), and Sync regenerates <code>data/music-library.json</code> in the repo from it — new songs get an iTunes cover lookup automatically. Upload first, then Sync; the site picks the JSON up in a minute or two.</p>

  <div class="mu-toolbar">
    <button id="muSync" type="button" class="primary">Sync &amp; publish</button>
    <button id="muReload" type="button" title="Reload the R2 listing">↻</button>
    <span class="fm-spacer"></span>
    <span id="muCounts" class="meta"></span>
  </div>
  <p id="muStatus" class="status" aria-live="polite"></p>

  <div id="muDrop">
    Drop an artist folder, an album folder or loose audio files here —
    <code>Artist/Album/Title-Artist.mp3</code> naming, mp3 · flac · m4a, up to 64 MB each.
    <div class="mu-dropbtns">
      <button id="muPickFolder" type="button">Upload folder…</button>
      <button id="muPickFiles" type="button">Upload files…</button>
    </div>
  </div>
  <input id="muFolderInput" type="file" multiple hidden webkitdirectory>
  <input id="muFilesInput" type="file" multiple hidden accept=".mp3,.flac,.m4a,audio/mpeg,audio/flac,audio/mp4">

  <section id="muPendingSection" hidden>
    <div class="recent-head">
      <h2>Ready to upload</h2>
      <button id="muStartUpload" type="button" class="primary">Upload</button>
    </div>
    <ul id="muPending"></ul>
  </section>

  <section id="muQueueSection" hidden>
    <div class="recent-head"><h2>Uploading…</h2></div>
    <ul id="muQueue"></ul>
  </section>

  <section id="muSyncBox" hidden>
    <strong id="muSyncHead"></strong>
    <ul id="muSyncMisses" hidden></ul>
  </section>

  <section>
    <div class="recent-head"><h2>Library</h2></div>
    <ul id="muList"></ul>
    <p class="empty" id="muEmpty" hidden>Nothing under the R2 music/ prefix yet.</p>
  </section>
</section>
<script>
(function () {
  "use strict";

  var MAX_BYTES = 64 * 1024 * 1024;
  var listEl = document.getElementById("muList");
  var emptyMsg = document.getElementById("muEmpty");
  var countsEl = document.getElementById("muCounts");
  var statusEl = document.getElementById("muStatus");
  var toastEl = document.getElementById("toast");
  var drop = document.getElementById("muDrop");
  var pendingSection = document.getElementById("muPendingSection");
  var pendingEl = document.getElementById("muPending");
  var startBtn = document.getElementById("muStartUpload");
  var queueSection = document.getElementById("muQueueSection");
  var queueEl = document.getElementById("muQueue");
  var syncBtn = document.getElementById("muSync");
  var syncBox = document.getElementById("muSyncBox");
  var syncHead = document.getElementById("muSyncHead");
  var syncMisses = document.getElementById("muSyncMisses");

  var pending = []; // {file, artist, album} staged for upload
  var uploading = false;

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
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.className = isError ? "status err" : "status";
  }

  function extOf(name) {
    var parts = String(name).split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  }

  function isAudio(name) {
    return ["mp3", "flac", "m4a"].indexOf(extOf(name)) !== -1;
  }

  // Derive Artist/Album from a dropped relative path. Extra leading segments
  // (the dragged root folder's own name) are stripped, mirroring the old
  // Artist/Album/file layout; anything shallower falls back to editable
  // "Unknown" defaults.
  function derivePath(rel) {
    var parts = rel.split("/");
    parts.pop(); // filename
    if (parts.length >= 2) {
      if (parts.length > 2) parts = parts.slice(parts.length - 2);
      return { artist: parts[0], album: parts[1] };
    }
    if (parts.length === 1) return { artist: "Unknown Artist", album: parts[0] };
    return { artist: "Unknown Artist", album: "Unknown Album" };
  }

  // --- library listing ------------------------------------------------------

  function loadTree() {
    setStatus("Loading…");
    fetch("/admin/api/music/tree")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { setStatus(data.error, true); return; }
        renderTree(data);
        setStatus("");
      })
      .catch(function () { setStatus("Could not load the library", true); });
  }

  function renderTree(data) {
    listEl.textContent = "";
    var songs = data.songs || [];
    var unpublished = 0;
    var lastGroup = null;
    songs.forEach(function (song) {
      if (song.published === false) unpublished++;
      var group = song.artist + " — " + song.album;
      if (group !== lastGroup) {
        lastGroup = group;
        var head = document.createElement("li");
        head.className = "mu-group";
        head.textContent = group;
        listEl.appendChild(head);
      }

      var li = document.createElement("li");
      li.className = "mu-song";

      var cover = document.createElement("div");
      cover.className = "mu-cover";
      if (song.cover) {
        var img = document.createElement("img");
        img.loading = "lazy";
        img.src = song.cover;
        img.alt = "";
        img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:6px;";
        cover.textContent = "";
        cover.appendChild(img);
      } else {
        cover.textContent = "♪";
      }

      var body = document.createElement("div");
      body.className = "mu-songbody";
      var title = document.createElement("div");
      title.className = "mu-title";
      title.textContent = song.title;
      var meta = document.createElement("div");
      meta.className = "mu-meta";
      meta.textContent = song.rel + " · " + fmtBytes(song.size);
      body.appendChild(title);
      body.appendChild(meta);

      var tools = document.createElement("div");
      tools.style.cssText = "display:flex;gap:6px;align-items:center;flex-shrink:0;";
      if (song.published === false) {
        var badge = document.createElement("span");
        badge.className = "mu-badge warn";
        badge.textContent = "not published";
        badge.title = "In R2 but missing from data/music-library.json — press Sync & publish";
        tools.appendChild(badge);
      }
      var del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Delete";
      del.addEventListener("click", function () { deleteSong(song); });
      tools.appendChild(del);

      li.appendChild(cover);
      li.appendChild(body);
      li.appendChild(tools);
      listEl.appendChild(li);
    });

    emptyMsg.hidden = songs.length > 0;
    countsEl.textContent = songs.length + " file" + (songs.length === 1 ? "" : "s") +
      (data.githubOk ? (unpublished ? " · " + unpublished + " not published" : " · all published") : " · GitHub unreadable");
  }

  function deleteSong(song) {
    if (!window.confirm("Delete " + song.rel + " from R2? The public JSON drops it on the next Sync. This cannot be undone.")) return;
    fetch("/admin/api/music?file=" + encodeURIComponent(song.key), { method: "DELETE" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { toast(data.error); return; }
        toast("Deleted — run Sync to update the site");
        loadTree();
      })
      .catch(function () { toast("Delete failed"); });
  }

  // --- staging + upload -------------------------------------------------------

  function renderPending() {
    pendingEl.textContent = "";
    pending.forEach(function (item, idx) {
      var li = document.createElement("li");
      li.className = "mu-pending";

      var name = document.createElement("span");
      name.className = "name";
      name.textContent = item.rel;
      li.appendChild(name);

      var artist = document.createElement("input");
      artist.className = "mu-pinput";
      artist.value = item.artist;
      artist.placeholder = "Artist";
      artist.setAttribute("aria-label", "Artist for " + item.file.name);
      artist.addEventListener("input", function () { item.artist = artist.value; });
      li.appendChild(artist);

      var album = document.createElement("input");
      album.className = "mu-pinput";
      album.value = item.album;
      album.placeholder = "Album";
      album.setAttribute("aria-label", "Album for " + item.file.name);
      album.addEventListener("input", function () { item.album = album.value; });
      li.appendChild(album);

      var size = document.createElement("span");
      size.className = "meta";
      size.textContent = fmtBytes(item.file.size);
      li.appendChild(size);

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "✕";
      remove.title = "Remove from the upload list";
      remove.addEventListener("click", function () {
        pending.splice(idx, 1);
        renderPending();
      });
      li.appendChild(remove);

      pendingEl.appendChild(li);
    });
    pendingSection.hidden = pending.length === 0;
    startBtn.textContent = "Upload " + pending.length + " file" + (pending.length === 1 ? "" : "s");
  }

  function addFiles(files) {
    Array.prototype.forEach.call(files || [], function (entry) {
      if (!entry.file || !isAudio(entry.file.name)) return;
      if (pending.some(function (p) { return p.rel === entry.rel; })) return;
      var where = derivePath(entry.rel);
      pending.push({ file: entry.file, rel: entry.rel, artist: where.artist, album: where.album });
    });
    renderPending();
  }

  // Plain <input> picks: webkitRelativePath gives the folder layout.
  function filesFromInput(fileList) {
    var out = [];
    Array.prototype.forEach.call(fileList || [], function (file) {
      var rel = file.webkitRelativePath || file.name;
      out.push({ file: file, rel: rel });
    });
    addFiles(out);
  }

  // Drag & drop, including folder traversal via the entries API. Entries must
  // be read synchronously in the drop handler before any await.
  function readEntries(items) {
    var out = [];
    var entries = [];
    for (var i = 0; i < items.length; i++) {
      var entry = null;
      if (items[i].webkitGetAsEntry) entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    function walk(entry, prefix) {
      if (entry.isFile) {
        return new Promise(function (resolve) {
          entry.file(function (file) {
            out.push({ file: file, rel: prefix + entry.name });
            resolve();
          }, resolve);
        });
      }
      if (entry.isDirectory) {
        var reader = entry.createReader();
        return new Promise(function (resolve) {
          var readBatch = function () {
            reader.readEntries(function (batch) {
              if (!batch.length) { resolve(); return; }
              Promise.all(batch.map(function (child) {
                return walk(child, prefix + entry.name + "/");
              })).then(readBatch);
            }, resolve);
          };
          readBatch();
        });
      }
      return Promise.resolve();
    }
    return Promise.all(entries.map(function (entry) { return walk(entry, ""); })).then(function () { return out; });
  }

  function uploadNext(index, onDone) {
    if (index >= pending.length) { onDone(); return; }
    var item = pending[index];
    var li = document.createElement("li");
    var row = document.createElement("div");
    row.className = "row-main";
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = item.rel;
    var size = document.createElement("span");
    size.className = "meta";
    size.textContent = fmtBytes(item.file.size);
    var status = document.createElement("span");
    status.className = "status";
    status.textContent = "Queued…";
    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(status);
    li.appendChild(row);
    queueEl.insertBefore(li, queueEl.firstChild);

    if (item.file.size > MAX_BYTES) {
      status.textContent = "Too large (>64MB)";
      status.className = "status err";
      uploadNext(index + 1, onDone);
      return;
    }

    var form = new FormData();
    form.append("files", item.file, item.file.name);
    form.append("artist", item.artist.trim() || "Unknown Artist");
    form.append("album", item.album.trim() || "Unknown Album");

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/admin/api/music/upload");
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        status.textContent = Math.round((e.loaded / e.total) * 100) + "%";
      }
    };
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* non-JSON body */ }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.uploaded && data.uploaded.length) {
        status.textContent = "Uploaded ✓";
        status.className = "status ok";
      } else {
        var msg = (data && data.error) || (data && data.failed && data.failed.join("; ")) || "HTTP " + xhr.status;
        status.textContent = msg;
        status.className = "status err";
      }
      uploadNext(index + 1, onDone);
    };
    xhr.onerror = function () {
      status.textContent = "Network error";
      status.className = "status err";
      uploadNext(index + 1, onDone);
    };
    status.textContent = "0%";
    xhr.send(form);
  }

  startBtn.addEventListener("click", function () {
    if (uploading || !pending.length) return;
    uploading = true;
    startBtn.disabled = true;
    queueSection.hidden = false;
    uploadNext(0, function () {
      uploading = false;
      startBtn.disabled = false;
      pending = [];
      renderPending();
      toast("Upload finished — press Sync & publish to update the site");
      loadTree();
    });
  });

  document.getElementById("muPickFolder").addEventListener("click", function () {
    document.getElementById("muFolderInput").click();
  });
  document.getElementById("muPickFiles").addEventListener("click", function () {
    document.getElementById("muFilesInput").click();
  });
  document.getElementById("muFolderInput").addEventListener("change", function (e) {
    filesFromInput(e.target.files);
    e.target.value = "";
  });
  document.getElementById("muFilesInput").addEventListener("change", function (e) {
    filesFromInput(e.target.files);
    e.target.value = "";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.add("drag");
    });
  });
  drop.addEventListener("dragleave", function (e) {
    if (e.relatedTarget && drop.contains(e.relatedTarget)) return;
    drop.classList.remove("drag");
  });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    drop.classList.remove("drag");
    if (e.dataTransfer.items && e.dataTransfer.items.length && e.dataTransfer.items[0].webkitGetAsEntry) {
      readEntries(e.dataTransfer.items).then(addFiles);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
      filesFromInput(e.dataTransfer.files);
    }
  });

  // --- sync -------------------------------------------------------------------

  function postJson(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  }

  function showSyncBox(headText, misses) {
    syncBox.hidden = false;
    syncHead.textContent = headText;
    syncMisses.textContent = "";
    if (misses && misses.length) {
      syncMisses.hidden = false;
      misses.forEach(function (rel) {
        var li = document.createElement("li");
        li.textContent = "No confident iTunes cover match: " + rel;
        syncMisses.appendChild(li);
      });
    } else {
      syncMisses.hidden = true;
    }
  }

  syncBtn.addEventListener("click", function () {
    if (syncBtn.disabled) return;
    syncBtn.disabled = true;
    syncBox.hidden = true;
    setStatus("Planning sync…");
    postJson("/admin/api/music/plan")
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || "HTTP " + r.status);
        return r.data;
      })
      .then(function (plan) {
        var needCover = plan.added.filter(function (a) { return !a.cover; });
        var chain = Promise.resolve();
        var done = 0;
        var misses = [];
        needCover.forEach(function (song) {
          chain = chain.then(function () {
            done++;
            setStatus("Cover lookup " + done + "/" + needCover.length + " — " + song.rel);
            return postJson("/admin/api/music/cover", { rel: song.rel }).then(function (r) {
              if (!r.ok || (r.data && r.data.miss)) misses.push(song.rel);
              return null;
            });
          });
        });
        return chain.then(function () {
          if (!plan.added.length && !plan.removedCount) {
            setStatus("Already up to date (" + plan.total + " songs)");
            showSyncBox("Already up to date — " + plan.total + " songs, nothing to publish.", misses.length ? misses : null);
            return null;
          }
          setStatus("Committing data/music-library.json…");
          return postJson("/admin/api/music/commit").then(function (r) {
            if (!r.ok) throw new Error(r.data.error || "HTTP " + r.status);
            var parts = [plan.total + " songs"];
            if (plan.added.length) parts.push("+" + plan.added.length + " new");
            if (plan.removedCount) parts.push("-" + plan.removedCount + " removed");
            var head = "Published: " + parts.join(", ") + ". Live on the site in a minute or two.";
            if (misses.length) head += " (" + misses.length + " without a cover)";
            setStatus("Published ✓ " + parts.join(", "), false);
            showSyncBox(head, misses);
            loadTree();
            return null;
          });
        });
      })
      .catch(function (error) {
        setStatus(String(error.message || error), true);
      })
      .then(function () {
        syncBtn.disabled = false;
      });
  });

  document.getElementById("muReload").addEventListener("click", loadTree);
  loadTree();
})();
</script>
</section>
`;
