// Content tab for the /admin page (interpolated into ADMIN_PAGE_HTML by
// admin_page.js): structured editors for the two JSON data files that drive
// the static site — data/gallery.json and data/creations.json. Saving
// commits the whole file to GitHub main via /admin/api/data (editor.js),
// same sha-conflict detection as the blog editor; the static host serves
// JSON as-is, so no CI step is involved. Self-contained fragment: own
// <style>, markup and IIFE, like the other tabs. The page's inline script
// runs inside admin_page's template literal, so — same rule as there — it
// avoids backticks and ${} entirely, and every backslash in page-side
// regex/string escapes is doubled here (\\d -> \d on the page).

export const CONTENT_TAB_HTML = `
<style>
  #tabContent .ct-switch { display: flex; gap: 8px; margin: 0 0 14px; }
  #tabContent .ct-tab { border-radius: 999px; padding: 6px 16px; }
  #tabContent .ct-tab.active { background: var(--color-accent-strong); border-color: var(--color-accent-strong); color: #fff; }
  #tabContent .ct-tab.active:hover { background: #12856f; border-color: #12856f; color: #fff; }
  #tabContent .ct-layout {
    display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start;
  }
  #tabContent .ct-side {
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px;
    padding: 10px; min-width: 0;
  }
  #tabContent .ct-side ul { max-height: 62vh; overflow-y: auto; }
  #galList li, #creList li { cursor: pointer; }
  #galList li.active, #creList li.active { border-color: var(--color-accent); background: var(--color-surface-alt); }
  #tabContent .ct-filter { display: flex; gap: 6px; margin: 0 0 8px; }
  #tabContent .ct-fbtn { padding: 2px 10px; font-size: 12px; border-radius: 999px; }
  #tabContent .ct-fbtn.active { background: var(--color-accent-strong); border-color: var(--color-accent-strong); color: #fff; }
  #tabContent .ct-fbtn.active:hover { background: #12856f; border-color: #12856f; color: #fff; }
  #tabContent .ct-thumb {
    width: 64px; height: 44px; object-fit: cover; border-radius: 6px; flex-shrink: 0; background: var(--color-bg);
  }
  #tabContent .ct-move { padding: 1px 7px; font-size: 12px; }
  #tabContent .ct-preview {
    max-width: 100%; max-height: 180px; border-radius: 8px; display: block; background: var(--color-bg);
  }
  #tabContent .ct-formhint { font-size: 12.5px; color: var(--color-text-muted); overflow-wrap: anywhere; }
  #tabContent .ct-embedhint { flex-basis: 100%; font-size: 12.5px; color: var(--color-text-muted); }
  #tabContent .ct-id { flex: 0 1 170px; }
  #ctPick {
    border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text);
    padding: 16px; max-width: 660px; width: calc(100% - 32px);
  }
  #ctPick::backdrop { background: rgba(0, 0, 0, .45); }
  #ctPick h2 { margin: 0 0 6px; }
  .ct-pickgrid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px;
    max-height: 55vh; overflow-y: auto; margin: 10px 0;
  }
  .ct-pickgrid img {
    width: 100%; height: 80px; object-fit: cover; border-radius: 6px; cursor: pointer; background: var(--color-bg);
  }
  .ct-pickgrid img:hover { outline: 2px solid var(--color-accent); }
  @media (max-width: 900px) {
    #tabContent .ct-layout { grid-template-columns: 1fr; }
  }
</style>
<section id="tabContent" hidden>
  <p class="hint">Structured editors for the JSON files behind the Gallery and Creations pages. Saving commits data/*.json to GitHub main — the static host picks it up in a minute or two (no CI involved), and every change is visible in git history.</p>

  <div class="ct-switch">
    <button id="ctBtnGallery" class="ct-tab active" type="button">Gallery</button>
    <button id="ctBtnCreations" class="ct-tab" type="button">Creations</button>
    <button id="ctBtnAchv" class="ct-tab" type="button">Achievements</button>
  </div>

  <div id="ctGallery" class="ct-layout">
    <aside class="ct-side">
      <div class="ed-side-head">
        <button id="galAdd" type="button" class="primary">+ Add</button>
        <button id="galReload" type="button" title="Reload from GitHub and discard local edits">↻</button>
      </div>
      <ul id="galList"></ul>
      <p class="empty" id="galEmpty" hidden>No images yet.</p>
    </aside>
    <div class="ct-main">
      <div class="ed-meta">
        <div class="ed-meta-row">
          <input id="galId" class="ct-id" type="text" placeholder="id" spellcheck="false" aria-label="Entry id">
          <input id="galDate" type="date" aria-label="Date">
        </div>
        <div class="ed-meta-row">
          <input id="galSrc" type="text" placeholder="image — ../images/… path or https://storage.nathanpenny.fun/…" spellcheck="false" aria-label="Image source">
          <button id="galPick" type="button" title="Pick one of your recent uploads">Pick…</button>
        </div>
        <img id="galPreview" class="ct-preview" alt="Preview of the image URL" hidden>
        <div class="ed-meta-row">
          <input id="galTitle" type="text" placeholder="Title" aria-label="Title">
          <input id="galCat" type="text" placeholder="category (portrait, anime, art, photo…)" aria-label="Category" list="galCatList">
          <datalist id="galCatList"></datalist>
        </div>
        <textarea id="galDesc" rows="2" placeholder="Description" aria-label="Description"></textarea>
      </div>
      <div class="ed-toolbar">
        <span class="ct-formhint">The image source is used as-is — files under ../images/… live in the repo, anything you uploaded via the Images tab has a storage.nathanpenny.fun URL.</span>
        <span class="ed-spacer"></span>
        <button id="galDelete" type="button" class="danger">Delete entry</button>
        <button id="galSave" type="button" class="primary">Save gallery.json</button>
      </div>
      <p id="ctGalStatus" class="ed-status" aria-live="polite"></p>
    </div>
  </div>

  <div id="ctCreations" class="ct-layout" hidden>
    <aside class="ct-side">
      <div class="ed-side-head">
        <button id="creAdd" type="button" class="primary">+ Add</button>
        <button id="creReload" type="button" title="Reload from GitHub and discard local edits">↻</button>
      </div>
      <div class="ct-filter" role="group" aria-label="Filter by type">
        <button id="creFAll" class="ct-fbtn active" type="button">All</button>
        <button id="creFSongs" class="ct-fbtn" type="button">Songs</button>
        <button id="creFVideos" class="ct-fbtn" type="button">Videos</button>
      </div>
      <ul id="creList"></ul>
      <p class="empty" id="creEmpty" hidden>No featured items here.</p>
    </aside>
    <div class="ct-main">
      <div class="ed-meta">
        <div class="ed-meta-row">
          <select id="creType" aria-label="Type">
            <option value="video">video</option>
            <option value="song">song</option>
          </select>
          <select id="creOrigin" aria-label="Origin">
            <option value="favorite">favorite</option>
            <option value="original">original</option>
          </select>
          <input id="creId" class="ct-id" type="text" placeholder="id" spellcheck="false" aria-label="Entry id">
          <input id="creDate" type="date" aria-label="Date">
        </div>
        <input id="creTitle" type="text" placeholder="Title" aria-label="Title">
        <textarea id="creDesc" rows="2" placeholder="Description" aria-label="Description"></textarea>
        <div class="ed-meta-row">
          <select id="crePlatform" aria-label="Video platform">
            <option value="file">video file (mp4 URL)</option>
            <option value="bilibili">Bilibili (BV watch link)</option>
            <option value="youtube">YouTube (watch link)</option>
          </select>
          <input id="creSrc" type="text" placeholder="src — see the platform selector" spellcheck="false" aria-label="Source URL">
          <span id="creEmbedHint" class="ct-embedhint"></span>
        </div>
        <div class="ed-meta-row" id="crePosterRow">
          <input id="crePoster" type="text" placeholder="poster image (shown before play) — ../images/… or https://…" spellcheck="false" aria-label="Poster">
          <button id="crePickPoster" type="button" title="Pick one of your recent uploads">Pick…</button>
        </div>
        <div class="ed-meta-row" id="creCoverRow">
          <input id="creCover" type="text" placeholder="cover image (song) — ../images/… or https://…" spellcheck="false" aria-label="Cover">
          <button id="crePickCover" type="button" title="Pick one of your recent uploads">Pick…</button>
        </div>
      </div>
      <div class="ed-toolbar">
        <span class="ct-formhint">Bilibili / YouTube entries embed the platform player on the site — the src stays the normal watch-page URL, the ID is extracted automatically. YouTube is unreachable in mainland China; prefer Bilibili for that audience.</span>
        <span class="ed-spacer"></span>
        <button id="creDelete" type="button" class="danger">Delete entry</button>
        <button id="creSave" type="button" class="primary">Save creations.json</button>
      </div>
      <p id="ctCreStatus" class="ed-status" aria-live="polite"></p>
    </div>
  </div>

  <div id="ctAchv" class="ct-layout" hidden>
    <aside class="ct-side">
      <div class="ed-side-head">
        <button id="achvAddSec" type="button" class="primary">+ Section</button>
        <button id="achvReload" type="button" title="Reload from GitHub and discard local edits">↻</button>
      </div>
      <ul id="achvSecList"></ul>
      <p class="empty" id="achvSecEmpty" hidden>No sections yet — add the first one (e.g. Publications).</p>
    </aside>
    <div class="ct-main">
      <div class="ed-meta">
        <div class="ed-meta-row">
          <input id="achvSecId" class="ct-id" type="text" placeholder="section id (publications)" spellcheck="false" aria-label="Section id" list="achvIdList">
          <datalist id="achvIdList">
            <option value="publications"></option>
            <option value="projects"></option>
            <option value="awards"></option>
            <option value="certificates"></option>
            <option value="talks"></option>
          </datalist>
          <input id="achvSecIcon" class="ct-id" type="text" placeholder="icon (fa-book)" spellcheck="false" aria-label="Section icon" list="achvIconList">
          <datalist id="achvIconList">
            <option value="fa-book"></option>
            <option value="fa-diagram-project"></option>
            <option value="fa-trophy"></option>
            <option value="fa-certificate"></option>
            <option value="fa-person-chalkboard"></option>
            <option value="fa-flask"></option>
          </datalist>
          <input id="achvSecTitle" type="text" placeholder="Section title" aria-label="Section title">
        </div>
      </div>
      <div id="achvItemsArea" hidden>
        <div class="ed-toolbar">
          <h2 style="margin:0;font-size:14px">Items <span class="meta" id="achvItemCount"></span></h2>
          <span class="ed-spacer"></span>
          <button id="achvAddItem" type="button">+ Item</button>
        </div>
        <ul id="achvItemList"></ul>
        <div class="ed-meta" id="achvItemForm" hidden>
          <div class="ed-meta-row">
            <input id="achvItemId" class="ct-id" type="text" placeholder="item id" spellcheck="false" aria-label="Item id">
            <input id="achvItemDate" type="month" aria-label="Date">
          </div>
          <div class="ed-meta-row">
            <input id="achvItemTitle" type="text" placeholder="Title" aria-label="Title">
            <input id="achvItemBadge" type="text" placeholder="badge (journal, conference, Award…)" aria-label="Badge">
          </div>
          <textarea id="achvItemDesc" rows="2" placeholder="Description (optional)" aria-label="Description"></textarea>
          <div id="achvLinks"></div>
          <div class="ed-meta-row">
            <button id="achvAddLink" type="button">+ Link</button>
          </div>
        </div>
      </div>
      <div class="ed-toolbar">
        <span class="ct-formhint">Dates are month-precision (YYYY-MM). Links must be absolute http(s) URLs; GitHub links get the GitHub icon automatically on the page.</span>
        <span class="ed-spacer"></span>
        <button id="achvSecDelete" type="button" class="danger">Delete section</button>
        <button id="achvSave" type="button" class="primary">Save achievements.json</button>
      </div>
      <p id="ctAchvStatus" class="ed-status" aria-live="polite"></p>
    </div>
  </div>

  <dialog id="ctPick">
    <h2>Pick an image</h2>
    <p class="hint">Your 100 most recent uploads — or upload a new one straight from your computer. Anything else (e.g. a music/ object) can be pasted into the field directly.</p>
    <div id="ctPickGrid" class="ct-pickgrid"></div>
    <div class="actions">
      <button id="ctPickUpload" type="button" class="primary">Upload from computer…</button>
      <input id="ctPickFile" type="file" hidden accept="image/*">
      <span class="ed-spacer"></span>
      <button id="ctPickClose" type="button">Close</button>
    </div>
  </dialog>
</section>
<script>
(function () {
  "use strict";

  function init() {
    // --- shared helpers ---------------------------------------------------

    var sections = {
      gallery: {
        sha: null, items: [], sel: -1, dirty: false,
        status: document.getElementById("ctGalStatus"),
        list: document.getElementById("galList"),
        empty: document.getElementById("galEmpty")
      },
      creations: {
        sha: null, items: [], sel: -1, dirty: false,
        status: document.getElementById("ctCreStatus"),
        list: document.getElementById("creList"),
        empty: document.getElementById("creEmpty")
      }
    };
    var section = "gallery";

    var ctGallery = document.getElementById("ctGallery");
    var ctCreations = document.getElementById("ctCreations");
    var ctAchv = document.getElementById("ctAchv");
    var ctBtnGallery = document.getElementById("ctBtnGallery");
    var ctBtnCreations = document.getElementById("ctBtnCreations");
    var ctBtnAchv = document.getElementById("ctBtnAchv");

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

    // Same Access-session guard as the other tabs.
    function api(path, opts) {
      return fetch(path, opts).then(function (res) {
        var ct = res.headers.get("content-type") || "";
        if (ct.indexOf("application/json") === -1) {
          var err = new Error("Access session expired — refresh the page to sign in again");
          err.session = true;
          throw err;
        }
        return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      });
    }

    function setStatus(kind, text, cls) {
      var el = sections[kind].status;
      el.textContent = text;
      el.className = "ed-status" + (cls ? " " + cls : "");
    }

    function todayLocal() {
      var d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function slugify(text) {
      var s = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      return s || "item";
    }

    // data/*.json store image paths relative to pages/ ("../images/…"), which
    // resolve against workers.nathanpenny.fun in this admin page and 404.
    // Previews rewrite them onto the site origin; saved data stays untouched.
    function displayUrl(src) {
      var s = String(src || "");
      if (/^https?:\\/\\//i.test(s)) return s;
      var clean = s.replace(/^(\\.\\/|\\.\\.\\/)+/, "");
      return clean ? "https://nathanpenny.fun/" + clean : "";
    }

    function uniqueId(items, base) {
      var id = base;
      var n = 2;
      while (items.some(function (x) { return x.id === id; })) {
        id = base + "-" + n;
        n += 1;
      }
      return id;
    }

    function moveItem(items, i, delta) {
      var j = i + delta;
      if (j < 0 || j >= items.length) return i;
      var t = items[i];
      items[i] = items[j];
      items[j] = t;
      return j;
    }

    function okToLeave(kind) {
      if (!sections[kind].dirty) return true;
      if (window.confirm("Discard unsaved changes?")) {
        sections[kind].dirty = false;
        return true;
      }
      return false;
    }

    function showSection(which) {
      section = which;
      ctGallery.hidden = which !== "gallery";
      ctCreations.hidden = which !== "creations";
      ctAchv.hidden = which !== "achievements";
      ctBtnGallery.className = "ct-tab" + (which === "gallery" ? " active" : "");
      ctBtnCreations.className = "ct-tab" + (which === "creations" ? " active" : "");
      ctBtnAchv.className = "ct-tab" + (which === "achievements" ? " active" : "");
    }

    ctBtnGallery.addEventListener("click", function () { if (okToLeave(section)) showSection("gallery"); });
    ctBtnCreations.addEventListener("click", function () { if (okToLeave(section)) showSection("creations"); });
    ctBtnAchv.addEventListener("click", function () { if (okToLeave(section)) showSection("achievements"); });

    // --- image picker (recent /upload listings) ----------------------------

    var pickDialog = document.getElementById("ctPick");
    var pickGrid = document.getElementById("ctPickGrid");
    var pickTarget = null;

    function openPick(target) {
      pickTarget = target;
      pickGrid.textContent = "";
      pickDialog.showModal();
      fetch("/upload?list=1").then(function (res) { return res.json(); }).then(function (data) {
        var objs = (data && data.objects) || [];
        if (!objs.length) {
          var p = document.createElement("p");
          p.className = "empty";
          p.textContent = "Nothing uploaded yet — use the Images tab first, or paste a URL.";
          pickGrid.appendChild(p);
          return;
        }
        objs.forEach(function (obj) {
          var img = document.createElement("img");
          img.src = obj.url;
          img.alt = obj.key;
          img.title = obj.key;
          img.loading = "lazy";
          img.addEventListener("click", function () {
            pickTarget.value = obj.url;
            pickTarget.dispatchEvent(new Event("input", { bubbles: false }));
            pickDialog.close();
            toast("URL filled in");
          });
          pickGrid.appendChild(img);
        });
      }).catch(function () {
        var p = document.createElement("p");
        p.className = "empty";
        p.textContent = "Could not load uploads.";
        pickGrid.appendChild(p);
      });
    }

    document.getElementById("ctPickClose").addEventListener("click", function () { pickDialog.close(); });
    pickDialog.addEventListener("click", function (e) { if (e.target === pickDialog) pickDialog.close(); });

    // Upload straight from the Pick dialog: file -> /upload -> URL filled in.
    var pickFile = document.getElementById("ctPickFile");
    document.getElementById("ctPickUpload").addEventListener("click", function () { pickFile.click(); });
    pickFile.addEventListener("change", function () {
      var file = pickFile.files[0];
      pickFile.value = "";
      if (!file || !pickTarget) return;
      var btn = document.getElementById("ctPickUpload");
      btn.disabled = true;
      btn.textContent = "Uploading…";
      var form = new FormData();
      form.append("files", file, file.name);
      fetch("/upload", { method: "POST", body: form })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (r) {
          btn.disabled = false;
          btn.textContent = "Upload from computer…";
          if (!r.ok || !r.data.uploaded || !r.data.uploaded.length) {
            toast((r.data && (r.data.error || (r.data.failed && r.data.failed.join("; ")))) || "Upload failed");
            return;
          }
          pickTarget.value = r.data.uploaded[0].url;
          pickTarget.dispatchEvent(new Event("input", { bubbles: false }));
          pickDialog.close();
          toast("Uploaded and filled in");
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = "Upload from computer…";
          toast("Upload failed");
        });
    });

    // --- gallery editor -----------------------------------------------------

    var gal = {
      id: document.getElementById("galId"),
      date: document.getElementById("galDate"),
      src: document.getElementById("galSrc"),
      preview: document.getElementById("galPreview"),
      title: document.getElementById("galTitle"),
      cat: document.getElementById("galCat"),
      catList: document.getElementById("galCatList"),
      desc: document.getElementById("galDesc")
    };

    function markDirty(kind) {
      sections[kind].dirty = true;
    }

    function renderCatList() {
      gal.catList.textContent = "";
      var seen = {};
      sections.gallery.items.forEach(function (it) {
        if (it.category && !seen[it.category]) {
          seen[it.category] = true;
          var opt = document.createElement("option");
          opt.value = it.category;
          gal.catList.appendChild(opt);
        }
      });
    }

    function galRenderList() {
      var s = sections.gallery;
      s.list.textContent = "";
      s.empty.hidden = s.items.length > 0;
      s.items.forEach(function (it, i) {
        var li = document.createElement("li");
        if (i === s.sel) li.classList.add("active");
        var main = document.createElement("div");
        main.className = "row-main";
        var thumb = document.createElement("img");
        thumb.className = "ct-thumb";
        thumb.src = displayUrl(it.src);
        thumb.alt = "";
        thumb.loading = "lazy";
        thumb.hidden = !it.src;
        var texts = document.createElement("div");
        var name = document.createElement("div");
        name.className = "name";
        name.textContent = it.title || "(untitled)";
        var meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = (it.category || "uncategorised") + " · " + (it.date || "");
        texts.appendChild(name);
        texts.appendChild(meta);
        main.appendChild(thumb);
        main.appendChild(texts);
        var tools = document.createElement("div");
        tools.className = "actions";
        tools.style.marginTop = "4px";
        [["↑", -1], ["↓", 1]].forEach(function (pair) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "ct-move";
          b.textContent = pair[0];
          b.title = "Move " + (pair[1] < 0 ? "up" : "down");
          b.addEventListener("click", function (e) {
            e.stopPropagation();
            if (!okToLeave("gallery")) return;
            s.sel = moveItem(s.items, i, pair[1]);
            s.dirty = true;
            galRenderList();
            galFillForm();
          });
          tools.appendChild(b);
        });
        var del = document.createElement("button");
        del.type = "button";
        del.className = "ct-move danger";
        del.textContent = "🗑";
        del.title = "Delete entry";
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!window.confirm('Delete entry "' + (it.title || it.id) + '"? (Removed only when you Save.)')) return;
          s.items.splice(i, 1);
          if (s.sel === i) s.sel = -1;
          else if (s.sel > i) s.sel -= 1;
          s.dirty = true;
          galRenderList();
          galFillForm();
        });
        tools.appendChild(del);
        li.appendChild(main);
        li.appendChild(tools);
        li.addEventListener("click", function () {
          if (i === s.sel) return;
          if (!okToLeave("gallery")) return;
          s.sel = i;
          galRenderList();
          galFillForm();
        });
        s.list.appendChild(li);
      });
    }

    function galFillForm() {
      var s = sections.gallery;
      var it = s.items[s.sel];
      var has = !!it;
      gal.id.value = has ? it.id : "";
      gal.date.value = has && it.date ? it.date : todayLocal();
      gal.src.value = has ? it.src : "";
      gal.title.value = has ? it.title : "";
      gal.cat.value = has ? it.category : "";
      gal.desc.value = has ? it.description : "";
      gal.preview.hidden = !has || !it.src;
      gal.preview.src = displayUrl(has ? it.src : "");
    }

    function galReadForm() {
      var s = sections.gallery;
      if (s.sel < 0) return;
      var it = s.items[s.sel];
      it.id = gal.id.value.trim();
      it.date = gal.date.value;
      it.src = gal.src.value.trim();
      it.title = gal.title.value.trim();
      it.category = gal.cat.value.trim();
      it.description = gal.desc.value;
      s.dirty = true;
    }

    gal.src.addEventListener("input", function () {
      gal.preview.hidden = !gal.src.value;
      gal.preview.src = displayUrl(gal.src.value);
    });
    [gal.id, gal.date, gal.src, gal.title, gal.cat, gal.desc].forEach(function (el) {
      el.addEventListener("input", function () { markDirty("gallery"); });
    });

    document.getElementById("galAdd").addEventListener("click", function () {
      var s = sections.gallery;
      if (!okToLeave("gallery")) return;
      s.items.push({
        id: uniqueId(s.items, slugify("gallery-" + todayLocal())),
        src: "",
        title: "",
        description: "",
        category: "",
        date: todayLocal()
      });
      s.sel = s.items.length - 1;
      s.dirty = true;
      galRenderList();
      galFillForm();
      gal.src.focus();
      setStatus("gallery", "New entry — fill the form, then Save.", "");
    });
    document.getElementById("galReload").addEventListener("click", function () {
      if (!okToLeave("gallery")) return;
      loadSection("gallery");
    });
    document.getElementById("galPick").addEventListener("click", function () {
      galReadForm();
      galRenderList();
      openPick(gal.src);
    });
    document.getElementById("galDelete").addEventListener("click", function () {
      var s = sections.gallery;
      if (s.sel < 0) { setStatus("gallery", "Select an entry first.", "err"); return; }
      if (!window.confirm("Delete the selected entry? (Removed only when you Save.)")) return;
      s.items.splice(s.sel, 1);
      s.sel = -1;
      s.dirty = true;
      galRenderList();
      galFillForm();
    });
    document.getElementById("galSave").addEventListener("click", function () {
      var s = sections.gallery;
      galReadForm();
      saveSection("gallery", s.items);
    });

    // --- creations editor -----------------------------------------------------

    var cre = {
      type: document.getElementById("creType"),
      origin: document.getElementById("creOrigin"),
      id: document.getElementById("creId"),
      date: document.getElementById("creDate"),
      title: document.getElementById("creTitle"),
      desc: document.getElementById("creDesc"),
      platform: document.getElementById("crePlatform"),
      src: document.getElementById("creSrc"),
      embedHint: document.getElementById("creEmbedHint"),
      poster: document.getElementById("crePoster"),
      posterRow: document.getElementById("crePosterRow"),
      cover: document.getElementById("creCover"),
      coverRow: document.getElementById("creCoverRow")
    };
    var creF = {
      all: document.getElementById("creFAll"),
      songs: document.getElementById("creFSongs"),
      videos: document.getElementById("creFVideos")
    };
    var creFilter = "all";

    function creSetFilter(f) {
      creFilter = f;
      creF.all.className = "ct-fbtn" + (f === "all" ? " active" : "");
      creF.songs.className = "ct-fbtn" + (f === "songs" ? " active" : "");
      creF.videos.className = "ct-fbtn" + (f === "videos" ? " active" : "");
      creRenderList();
    }

    creF.all.addEventListener("click", function () { creSetFilter("all"); });
    creF.songs.addEventListener("click", function () { creSetFilter("songs"); });
    creF.videos.addEventListener("click", function () { creSetFilter("videos"); });

    // Mirrors videoEmbedUrl() in main.js — shows what the site will extract.
    function embedIdOf(platform, src) {
      if (platform === "bilibili") {
        var b = /bilibili\\.com\\/video\\/(BV[0-9A-Za-z]{10})/i.exec(src || "");
        if (!b) return null;
        var p = /[?&]p=(\\d+)/.exec(src || "");
        return b[1] + (p ? " · page " + p[1] : "");
      }
      if (platform === "youtube") {
        var y = /(?:youtube\\.com\\/(?:watch\\?v=|shorts\\/)|youtu\\.be\\/)([A-Za-z0-9_-]{11})/.exec(src || "");
        return y ? "ID " + y[1] : null;
      }
      return null;
    }

    function creSyncRows() {
      var isVideo = cre.type.value === "video";
      cre.posterRow.hidden = !isVideo;
      cre.platform.hidden = !isVideo;
      cre.coverRow.hidden = isVideo;
      if (isVideo) {
        var id = embedIdOf(cre.platform.value, cre.src.value.trim());
        if (cre.platform.value === "file") cre.embedHint.textContent = "";
        else cre.embedHint.textContent = id ? "Will embed: " + id : "No ID found yet — paste the normal watch-page URL.";
      } else {
        cre.embedHint.textContent = "";
      }
    }

    function creRenderList() {
      var s = sections.creations;
      s.list.textContent = "";
      var shown = 0;
      s.items.forEach(function (it, i) {
        if (creFilter !== "all" && ((creFilter === "songs") !== (it.type === "song"))) return;
        shown += 1;
        var li = document.createElement("li");
        if (i === s.sel) li.classList.add("active");
        var main = document.createElement("div");
        main.className = "row-main";
        var name = document.createElement("span");
        name.className = "name";
        name.textContent = (it.type === "song" ? "♪ " : "▶ ") + (it.title || "(untitled)");
        var meta = document.createElement("span");
        meta.className = "meta";
        var extra = it.type === "video" && it.platform && it.platform !== "file" ? " · " + it.platform : "";
        meta.textContent = it.type + " · " + (it.date || "") + extra;
        main.appendChild(name);
        main.appendChild(meta);
        var tools = document.createElement("div");
        tools.className = "actions";
        tools.style.marginTop = "4px";
        [["↑", -1], ["↓", 1]].forEach(function (pair) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "ct-move";
          b.textContent = pair[0];
          b.title = "Move " + (pair[1] < 0 ? "up" : "down");
          b.addEventListener("click", function (e) {
            e.stopPropagation();
            if (!okToLeave("creations")) return;
            s.sel = moveItem(s.items, i, pair[1]);
            s.dirty = true;
            creRenderList();
            creFillForm();
          });
          tools.appendChild(b);
        });
        var del = document.createElement("button");
        del.type = "button";
        del.className = "ct-move danger";
        del.textContent = "🗑";
        del.title = "Delete entry";
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!window.confirm('Delete entry "' + (it.title || it.id) + '"? (Removed only when you Save.)')) return;
          s.items.splice(i, 1);
          if (s.sel === i) s.sel = -1;
          else if (s.sel > i) s.sel -= 1;
          s.dirty = true;
          creRenderList();
          creFillForm();
        });
        tools.appendChild(del);
        li.appendChild(main);
        li.appendChild(tools);
        li.addEventListener("click", function () {
          if (i === s.sel) return;
          if (!okToLeave("creations")) return;
          s.sel = i;
          creRenderList();
          creFillForm();
        });
        s.list.appendChild(li);
      });
      s.empty.hidden = shown > 0;
      s.empty.textContent = s.items.length ? "Nothing matches this filter." : "No featured items here.";
    }

    function creFillForm() {
      var s = sections.creations;
      var it = s.items[s.sel];
      var has = !!it;
      cre.type.value = has ? it.type : "video";
      cre.origin.value = has && it.origin ? it.origin : "favorite";
      cre.id.value = has ? it.id : "";
      cre.date.value = has && it.date ? it.date : todayLocal();
      cre.title.value = has ? it.title : "";
      cre.desc.value = has ? it.description : "";
      cre.platform.value = has && it.platform ? it.platform : "file";
      cre.src.value = has ? it.src : "";
      cre.poster.value = has && it.poster ? it.poster : "";
      cre.cover.value = has && it.cover ? it.cover : "";
      creSyncRows();
    }

    function creReadForm() {
      var s = sections.creations;
      if (s.sel < 0) return;
      var it = s.items[s.sel];
      it.type = cre.type.value;
      it.origin = cre.origin.value;
      it.id = cre.id.value.trim();
      it.date = cre.date.value;
      it.title = cre.title.value.trim();
      it.description = cre.desc.value;
      if (it.type === "video") {
        it.platform = cre.platform.value;
        it.src = cre.src.value.trim();
        it.poster = cre.poster.value.trim();
      } else {
        it.src = cre.src.value.trim();
        it.cover = cre.cover.value.trim();
      }
      s.dirty = true;
    }

    [cre.type, cre.origin, cre.id, cre.date, cre.title, cre.desc, cre.platform, cre.src, cre.poster, cre.cover].forEach(function (el) {
      el.addEventListener("input", function () { markDirty("creations"); creSyncRows(); });
    });
    cre.type.addEventListener("change", function () { markDirty("creations"); creSyncRows(); });
    cre.platform.addEventListener("change", function () { markDirty("creations"); creSyncRows(); });

    document.getElementById("creAdd").addEventListener("click", function () {
      var s = sections.creations;
      if (!okToLeave("creations")) return;
      creSetFilter("all");
      s.items.push({
        id: uniqueId(s.items, slugify("creations-" + todayLocal())),
        type: "video",
        origin: "favorite",
        title: "",
        description: "",
        src: "",
        platform: "file",
        poster: "",
        date: todayLocal()
      });
      s.sel = s.items.length - 1;
      s.dirty = true;
      creRenderList();
      creFillForm();
      cre.title.focus();
      setStatus("creations", "New entry — fill the form, then Save.", "");
    });
    document.getElementById("creReload").addEventListener("click", function () {
      if (!okToLeave("creations")) return;
      loadSection("creations");
    });
    document.getElementById("crePickPoster").addEventListener("click", function () {
      creReadForm();
      creRenderList();
      openPick(cre.poster);
    });
    document.getElementById("crePickCover").addEventListener("click", function () {
      creReadForm();
      creRenderList();
      openPick(cre.cover);
    });
    document.getElementById("creDelete").addEventListener("click", function () {
      var s = sections.creations;
      if (s.sel < 0) { setStatus("creations", "Select an entry first.", "err"); return; }
      if (!window.confirm("Delete the selected entry? (Removed only when you Save.)")) return;
      s.items.splice(s.sel, 1);
      s.sel = -1;
      s.dirty = true;
      creRenderList();
      creFillForm();
    });
    document.getElementById("creSave").addEventListener("click", function () {
      var s = sections.creations;
      creReadForm();
      saveSection("creations", s.items);
    });

    // --- achievements editor (ordered sections -> ordered items) ------------
    // Form fields write straight into the model on input (dirty-flag only);
    // list re-renders happen on change/blur and on structural actions, so
    // typing never steals focus.

    var ach = {
      secList: document.getElementById("achvSecList"),
      secEmpty: document.getElementById("achvSecEmpty"),
      secId: document.getElementById("achvSecId"),
      secIcon: document.getElementById("achvSecIcon"),
      secTitle: document.getElementById("achvSecTitle"),
      itemArea: document.getElementById("achvItemsArea"),
      itemList: document.getElementById("achvItemList"),
      itemCount: document.getElementById("achvItemCount"),
      itemForm: document.getElementById("achvItemForm"),
      itemId: document.getElementById("achvItemId"),
      itemDate: document.getElementById("achvItemDate"),
      itemTitle: document.getElementById("achvItemTitle"),
      itemBadge: document.getElementById("achvItemBadge"),
      itemDesc: document.getElementById("achvItemDesc"),
      links: document.getElementById("achvLinks")
    };
    sections.achievements = {
      sha: null, items: [], dirty: false,
      status: document.getElementById("ctAchvStatus"),
      list: ach.secList,
      empty: ach.secEmpty
    };
    var achvSelSec = -1;
    var achvSelItem = -1;

    function achvSec() {
      var s = sections.achievements;
      return achvSelSec >= 0 && achvSelSec < s.items.length ? s.items[achvSelSec] : null;
    }

    function achvItem() {
      var sec = achvSec();
      return sec && achvSelItem >= 0 && achvSelItem < sec.items.length ? sec.items[achvSelItem] : null;
    }

    function achvMonthLabel(v) {
      var m = /^(\\d{4})-(\\d{2})/.exec(String(v || ""));
      if (!m) return String(v || "");
      var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      var mi = parseInt(m[2], 10);
      return mi >= 1 && mi <= 12 ? months[mi - 1] + " " + m[1] : String(v);
    }

    function achvRenderSections() {
      var s = sections.achievements;
      ach.secList.textContent = "";
      s.empty.hidden = s.items.length > 0;
      s.items.forEach(function (sec, i) {
        var li = document.createElement("li");
        if (i === achvSelSec) li.classList.add("active");
        var main = document.createElement("div");
        main.className = "row-main";
        var name = document.createElement("span");
        name.className = "name";
        name.textContent = sec.title || "(untitled)";
        var meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = (sec.items ? sec.items.length : 0) + " items";
        main.appendChild(name);
        main.appendChild(meta);
        var tools = document.createElement("div");
        tools.className = "actions";
        tools.style.marginTop = "4px";
        [["↑", -1], ["↓", 1]].forEach(function (pair) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "ct-move";
          b.textContent = pair[0];
          b.title = "Move " + (pair[1] < 0 ? "up" : "down");
          b.addEventListener("click", function (e) {
            e.stopPropagation();
            achvSelSec = moveItem(s.items, i, pair[1]);
            achvSelItem = -1;
            s.dirty = true;
            achvRenderAll();
          });
          tools.appendChild(b);
        });
        var del = document.createElement("button");
        del.type = "button";
        del.className = "ct-move danger";
        del.textContent = "🗑";
        del.title = "Delete section";
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!window.confirm('Delete section "' + (sec.title || sec.id) + '" and all its items? (Removed only when you Save.)')) return;
          s.items.splice(i, 1);
          if (achvSelSec === i) { achvSelSec = -1; achvSelItem = -1; }
          else if (achvSelSec > i) achvSelSec -= 1;
          s.dirty = true;
          achvRenderAll();
        });
        tools.appendChild(del);
        li.appendChild(main);
        li.appendChild(tools);
        li.addEventListener("click", function () {
          if (i === achvSelSec) return;
          achvSelSec = i;
          achvSelItem = -1;
          achvRenderAll();
        });
        ach.secList.appendChild(li);
      });
    }

    function achvRenderItems() {
      var s = sections.achievements;
      var sec = achvSec();
      ach.itemList.textContent = "";
      var items = sec ? sec.items : [];
      ach.itemCount.textContent = "(" + items.length + ")";
      items.forEach(function (it, i) {
        var li = document.createElement("li");
        if (i === achvSelItem) li.classList.add("active");
        var main = document.createElement("div");
        main.className = "row-main";
        var name = document.createElement("span");
        name.className = "name";
        name.textContent = it.title || "(untitled)";
        var meta = document.createElement("span");
        meta.className = "meta";
        var bits = [];
        if (it.badge) bits.push(it.badge);
        if (it.date) bits.push(achvMonthLabel(it.date));
        meta.textContent = bits.join(" · ");
        main.appendChild(name);
        main.appendChild(meta);
        var tools = document.createElement("div");
        tools.className = "actions";
        tools.style.marginTop = "4px";
        var edit = document.createElement("button");
        edit.type = "button";
        edit.className = "ct-move";
        edit.textContent = "✎";
        edit.title = "Edit item";
        edit.addEventListener("click", function (e) {
          e.stopPropagation();
          achvSelItem = i;
          achvRenderAll();
        });
        tools.appendChild(edit);
        [["↑", -1], ["↓", 1]].forEach(function (pair) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "ct-move";
          b.textContent = pair[0];
          b.title = "Move " + (pair[1] < 0 ? "up" : "down");
          b.addEventListener("click", function (e) {
            e.stopPropagation();
            achvSelItem = moveItem(sec.items, i, pair[1]);
            s.dirty = true;
            achvRenderAll();
          });
          tools.appendChild(b);
        });
        var del = document.createElement("button");
        del.type = "button";
        del.className = "ct-move danger";
        del.textContent = "🗑";
        del.title = "Delete item";
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!window.confirm('Delete item "' + (it.title || it.id) + '"? (Removed only when you Save.)')) return;
          sec.items.splice(i, 1);
          if (achvSelItem === i) achvSelItem = -1;
          else if (achvSelItem > i) achvSelItem -= 1;
          s.dirty = true;
          achvRenderAll();
        });
        tools.appendChild(del);
        li.appendChild(main);
        li.appendChild(tools);
        li.addEventListener("click", function () {
          if (i === achvSelItem) return;
          achvSelItem = i;
          achvRenderAll();
        });
        ach.itemList.appendChild(li);
      });
    }

    function achvRenderLinks() {
      var s = sections.achievements;
      var it = achvItem();
      ach.links.textContent = "";
      if (!it) return;
      if (!it.links) it.links = [];
      it.links.forEach(function (l, k) {
        var row = document.createElement("div");
        row.className = "ed-meta-row";
        var lab = document.createElement("input");
        lab.type = "text";
        lab.placeholder = "label (Read it here)";
        lab.value = l.label || "";
        var url = document.createElement("input");
        url.type = "text";
        url.placeholder = "https://…";
        url.spellcheck = false;
        url.style.flex = "1 1 220px";
        url.value = l.url || "";
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "danger";
        rm.textContent = "×";
        rm.title = "Remove link";
        lab.addEventListener("input", function () { l.label = lab.value; s.dirty = true; });
        url.addEventListener("input", function () { l.url = url.value.trim(); s.dirty = true; });
        rm.addEventListener("click", function () {
          it.links.splice(k, 1);
          if (!it.links.length) delete it.links;
          s.dirty = true;
          achvRenderLinks();
        });
        row.appendChild(lab);
        row.appendChild(url);
        row.appendChild(rm);
        ach.links.appendChild(row);
      });
    }

    function achvFillSecForm() {
      var sec = achvSec();
      ach.secId.value = sec ? sec.id : "";
      ach.secIcon.value = sec && sec.icon ? sec.icon : "";
      ach.secTitle.value = sec ? sec.title : "";
    }

    function achvFillItemForm() {
      var it = achvItem();
      ach.itemForm.hidden = !it;
      ach.itemId.value = it ? it.id : "";
      ach.itemDate.value = it && it.date ? it.date : "";
      ach.itemTitle.value = it ? it.title : "";
      ach.itemBadge.value = it && it.badge ? it.badge : "";
      ach.itemDesc.value = it && it.description ? it.description : "";
      achvRenderLinks();
    }

    function achvRenderAll() {
      achvRenderSections();
      achvFillSecForm();
      achvRenderItems();
      achvFillItemForm();
      ach.itemArea.hidden = !achvSec();
    }

    (function achvBindSec() {
      var s = sections.achievements;
      function write() {
        var sec = achvSec();
        if (!sec) return;
        sec.id = ach.secId.value.trim();
        sec.icon = ach.secIcon.value.trim();
        sec.title = ach.secTitle.value;
        s.dirty = true;
      }
      [ach.secId, ach.secIcon, ach.secTitle].forEach(function (el) {
        el.addEventListener("input", write);
        el.addEventListener("change", function () { write(); achvRenderSections(); });
      });
    })();

    (function achvBindItem() {
      var s = sections.achievements;
      function write() {
        var it = achvItem();
        if (!it) return;
        it.id = ach.itemId.value.trim();
        it.title = ach.itemTitle.value;
        it.badge = ach.itemBadge.value.trim();
        it.description = ach.itemDesc.value;
        var d = ach.itemDate.value;
        if (d) it.date = d;
        else delete it.date;
        s.dirty = true;
      }
      [ach.itemId, ach.itemTitle, ach.itemBadge, ach.itemDesc].forEach(function (el) {
        el.addEventListener("input", write);
        el.addEventListener("change", function () { write(); achvRenderItems(); });
      });
      ach.itemDate.addEventListener("input", write);
      ach.itemDate.addEventListener("change", function () { write(); achvRenderItems(); });
    })();

    document.getElementById("achvAddSec").addEventListener("click", function () {
      var s = sections.achievements;
      s.items.push({ id: uniqueId(s.items, "new-section"), icon: "", title: "", items: [] });
      achvSelSec = s.items.length - 1;
      achvSelItem = -1;
      s.dirty = true;
      achvRenderAll();
      ach.secTitle.focus();
      setStatus("achievements", "New section — set the title, then add items.", "");
    });
    document.getElementById("achvReload").addEventListener("click", function () {
      if (okToLeave("achievements")) loadSection("achievements");
    });
    document.getElementById("achvAddItem").addEventListener("click", function () {
      var s = sections.achievements;
      var sec = achvSec();
      if (!sec) { setStatus("achievements", "Select or create a section first.", "err"); return; }
      sec.items.push({ id: uniqueId(sec.items, "new-item"), title: "", badge: "", description: "" });
      achvSelItem = sec.items.length - 1;
      s.dirty = true;
      achvRenderAll();
      ach.itemTitle.focus();
    });
    document.getElementById("achvAddLink").addEventListener("click", function () {
      var s = sections.achievements;
      var it = achvItem();
      if (!it) return;
      if (!it.links) it.links = [];
      it.links.push({ label: "", url: "" });
      s.dirty = true;
      achvRenderLinks();
    });
    document.getElementById("achvSecDelete").addEventListener("click", function () {
      var s = sections.achievements;
      var sec = achvSec();
      if (!sec) { setStatus("achievements", "Select a section first.", "err"); return; }
      if (!window.confirm('Delete section "' + (sec.title || sec.id) + '" and all its items? (Removed only when you Save.)')) return;
      s.items.splice(achvSelSec, 1);
      achvSelSec = -1;
      achvSelItem = -1;
      s.dirty = true;
      achvRenderAll();
    });
    document.getElementById("achvSave").addEventListener("click", function () {
      saveSection("achievements", sections.achievements.items);
    });

    // --- load + save ---------------------------------------------------------

    function loadSection(kind) {
      var s = sections[kind];
      setStatus(kind, "Loading…", "");
      api("/admin/api/data?file=" + kind).then(function (r) {
        if (!r.ok) {
          setStatus(kind, r.data.error || ("HTTP " + r.status), "err");
          return;
        }
        var parsed;
        try {
          parsed = JSON.parse(r.data.content);
        } catch (e) {
          setStatus(kind, "The file on GitHub is not valid JSON — fix it by hand first.", "err");
          return;
        }
        s.sha = r.data.sha;
        s.items = Array.isArray(parsed) ? parsed : [];
        s.sel = s.items.length ? 0 : -1;
        s.dirty = false;
        if (kind === "gallery") {
          galRenderList();
          galFillForm();
          renderCatList();
        } else if (kind === "creations") {
          creRenderList();
          creFillForm();
        } else {
          achvSelSec = s.items.length ? 0 : -1;
          achvSelItem = -1;
          achvRenderAll();
        }
        setStatus(kind, "Loaded " + s.items.length + " entr" + (s.items.length === 1 ? "y" : "ies") + " (editable; Save commits to GitHub).", "ok");
      }).catch(function (err) {
        setStatus(kind, err.message || "Load failed", "err");
      });
    }

    function saveSection(kind, items) {
      var s = sections[kind];
      // Keep the files tidy: songs carry a cover, videos a poster + optional
      // platform; unknown extra keys pass through untouched.
      var clean = items.map(function (it) {
        var o = {};
        Object.keys(it).forEach(function (k) { o[k] = it[k]; });
        if (kind !== "achievements") {
          if (o.type === "song") {
            delete o.poster;
            delete o.platform;
          } else {
            delete o.cover;
            if (o.platform === "file" || !o.platform) delete o.platform;
          }
        }
        return o;
      });
      var text = JSON.stringify(clean, null, 2) + "\\n";
      var btn = document.getElementById(kind === "gallery" ? "galSave" : (kind === "creations" ? "creSave" : "achvSave"));
      btn.disabled = true;
      setStatus(kind, "Committing to GitHub…", "");
      var payload = { file: kind, content: text };
      if (s.sha) payload.sha = s.sha;
      api("/admin/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          setStatus(kind, r.data.error || ("HTTP " + r.status), "err");
          if (r.status === 409) toast("Changed on GitHub — press ↻ to reload");
          return;
        }
        s.sha = r.data.sha;
        s.items = clean;
        s.dirty = false;
        if (kind === "gallery") {
          galRenderList();
          galFillForm();
          renderCatList();
        } else if (kind === "creations") {
          creRenderList();
          creFillForm();
        } else {
          achvRenderAll();
        }
        setStatus(kind, "Saved — the live page updates in a minute or two.", "ok");
        toast("Committed to GitHub");
      }).catch(function (err) {
        btn.disabled = false;
        setStatus(kind, err.message || "Save failed", "err");
      });
    }

    loadSection("gallery");
    loadSection("creations");
    loadSection("achievements");
  }

  // This script sits inside <main>, before the shared #toast element, so
  // wait for the DOM to settle before grabbing anything.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>`;
