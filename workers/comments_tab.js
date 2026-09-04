// Comment moderation tab for the /admin page (interpolated into
// ADMIN_PAGE_HTML by admin_page.js). Self-contained fragment: own <style>,
// markup and IIFE, like the other tabs. The page's inline script runs inside
// admin_page's template literal, so — same rule as there — it avoids
// backticks and ${} entirely, and every backslash in page-side escapes is
// doubled here.
//
// Backed by moderation.js: GET/DELETE /admin/api/comment(s) and the
// banned_ips blocklist (/admin/api/ban[s]). Deleting is permanent (a D1
// row); banning records the sender's salted IP hash so POST /comments
// rejects future comments from that network address. Everything user-
// supplied goes through textContent — never innerHTML.

export const COMMENTS_TAB_HTML = `
<style>
  #tabComments .cm-grid {
    display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 300px; align-items: start;
  }
  #tabComments .cm-col h2 { margin: 0 0 8px; }
  #tabComments .cm-row-main { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
  #tabComments .cm-content { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
  #tabComments .cm-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  #tabComments .cm-hash {
    font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--color-text-muted);
  }
  #tabComments .cm-side button { margin-left: auto; }
  #tabComments #cmBanHash {
    width: 100%; font: inherit; font-size: 13px; padding: 6px 9px; margin-bottom: 6px;
    border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text);
  }
  #tabComments #cmMore { margin: 12px auto 0; display: block; }
  @media (max-width: 900px) {
    #tabComments .cm-grid { grid-template-columns: 1fr; }
  }
</style>
<section id="tabComments" hidden>
  <p class="hint">Every comment, including the email and the sender's salted IP hash (the address itself is never stored). Delete spam, or ban a sender so POST /comments rejects them from now on.</p>
  <div class="cm-grid">
    <div class="cm-col">
      <div class="recent-head">
        <h2>Comments <span class="meta" id="cmTotal"></span></h2>
        <button id="cmRefresh" type="button">↻ Refresh</button>
      </div>
      <ul id="cmList"></ul>
      <p class="empty" id="cmEmpty" hidden>No comments yet.</p>
      <button id="cmMore" type="button" hidden>Load more</button>
    </div>
    <div class="cm-col cm-side">
      <h2>Banned senders</h2>
      <p class="hint" style="margin:4px 0 8px">Ban = the sender's salted IP hash goes on the blocklist; future comments from that network address get a 403. Existing comments are never touched by a ban.</p>
      <ul id="cmBanList"></ul>
      <p class="empty" id="cmBanEmpty" hidden>Nobody is banned.</p>
      <input id="cmBanHash" placeholder="ip_hash (hex) to ban by hand" aria-label="ip hash" spellcheck="false">
      <button id="cmBanAdd" type="button">Ban</button>
    </div>
  </div>
</section>
<script>
(function () {
  "use strict";

  function init() {
    var listEl = document.getElementById("cmList");
    var emptyEl = document.getElementById("cmEmpty");
    var totalEl = document.getElementById("cmTotal");
    var moreBtn = document.getElementById("cmMore");
    var banListEl = document.getElementById("cmBanList");
    var banEmptyEl = document.getElementById("cmBanEmpty");
    var banHashEl = document.getElementById("cmBanHash");
    var offset = 0;
    var PAGE = 50;

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

    // Same Access-session guard as the editor tab: the edge answers a dead
    // session with login-page HTML instead of JSON.
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

    function fmtDate(sql) {
      var d = new Date(String(sql).replace(" ", "T") + "Z");
      return isNaN(d.getTime()) ? String(sql) : d.toLocaleString();
    }

    function banSender(hash, note, done) {
      api("/admin/api/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip_hash: hash, note: note || "" })
      }).then(function (r) {
        if (!r.ok) { toast(r.data.error || "Ban failed"); return; }
        toast("Sender banned");
        if (done) done();
        loadBans();
      }).catch(function () { toast("Ban failed"); });
    }

    function renderComment(c) {
      var li = document.createElement("li");

      var main = document.createElement("div");
      main.className = "cm-row-main";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = c.name;
      var hash = document.createElement("span");
      hash.className = "cm-hash";
      hash.textContent = c.ip_hash ? c.ip_hash.slice(0, 8) + "…" : "(no hash — posted before moderation)";
      hash.title = c.ip_hash || "";
      var date = document.createElement("span");
      date.className = "meta";
      date.textContent = fmtDate(c.created_at);
      main.appendChild(name);
      main.appendChild(hash);
      main.appendChild(date);

      var mail = document.createElement("div");
      mail.className = "meta";
      mail.textContent = c.email;

      var body = document.createElement("p");
      body.className = "cm-content";
      body.textContent = c.content;

      var actions = document.createElement("div");
      actions.className = "cm-actions";

      var del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        if (!window.confirm("Delete this comment by " + c.name + "?")) return;
        api("/admin/api/comment?id=" + c.id, { method: "DELETE" }).then(function (r) {
          if (!r.ok) { toast(r.data.error || "Delete failed"); return; }
          li.remove();
          emptyEl.hidden = listEl.children.length > 0;
          refreshTotals();
          toast("Deleted");
        }).catch(function () { toast("Delete failed"); });
      });
      actions.appendChild(del);

      if (c.ip_hash) {
        var banDel = document.createElement("button");
        banDel.type = "button";
        banDel.textContent = "Ban & delete";
        banDel.addEventListener("click", function () {
          if (!window.confirm("Ban sender " + c.ip_hash.slice(0, 8) + "… and delete this comment?")) return;
          banSender(c.ip_hash, "comment #" + c.id, function () {
            api("/admin/api/comment?id=" + c.id, { method: "DELETE" }).then(function (r) {
              if (r.ok) {
                li.remove();
                emptyEl.hidden = listEl.children.length > 0;
                refreshTotals();
              }
              toast("Banned & deleted");
            }).catch(function () { toast("Delete failed"); });
          });
        });
        actions.appendChild(banDel);
      }

      li.appendChild(main);
      li.appendChild(mail);
      li.appendChild(body);
      li.appendChild(actions);
      return li;
    }

    function refreshTotals() {
      api("/admin/api/comments?offset=0").then(function (r) {
        if (r.ok) totalEl.textContent = r.data.total ? "(" + r.data.total + ")" : "";
      }).catch(function () { /* cosmetic */ });
    }

    function loadComments(reset) {
      if (reset) {
        offset = 0;
        listEl.textContent = "";
      }
      api("/admin/api/comments?offset=" + offset).then(function (r) {
        if (!r.ok) {
          emptyEl.hidden = false;
          emptyEl.textContent = r.data.error || ("HTTP " + r.status);
          return;
        }
        var rows = r.data.comments || [];
        rows.forEach(function (c) { listEl.appendChild(renderComment(c)); });
        if (reset) emptyEl.hidden = rows.length > 0;
        offset += rows.length;
        totalEl.textContent = r.data.total ? "(" + r.data.total + ")" : "";
        moreBtn.hidden = !r.data.total || offset >= r.data.total;
      }).catch(function (err) {
        emptyEl.hidden = false;
        emptyEl.textContent = err.message || "Load failed";
      });
    }

    function loadBans() {
      api("/admin/api/bans").then(function (r) {
        if (!r.ok) return;
        var bans = r.data.bans || [];
        banListEl.textContent = "";
        banEmptyEl.hidden = bans.length > 0;
        bans.forEach(function (b) {
          var li = document.createElement("li");
          var main = document.createElement("div");
          main.className = "cm-row-main";
          var h = document.createElement("span");
          h.className = "cm-hash";
          h.textContent = b.ip_hash;
          var d = document.createElement("span");
          d.className = "meta";
          d.textContent = b.note || fmtDate(b.created_at);
          var un = document.createElement("button");
          un.type = "button";
          un.className = "danger";
          un.textContent = "Unban";
          un.addEventListener("click", function () {
            api("/admin/api/ban?ip_hash=" + encodeURIComponent(b.ip_hash), { method: "DELETE" }).then(function (r) {
              if (!r.ok) { toast(r.data.error || "Unban failed"); return; }
              li.remove();
              banEmptyEl.hidden = banListEl.children.length > 0;
              toast("Unbanned");
            }).catch(function () { toast("Unban failed"); });
          });
          main.appendChild(h);
          main.appendChild(d);
          main.appendChild(un);
          li.appendChild(main);
          banListEl.appendChild(li);
        });
      }).catch(function () { /* cosmetic */ });
    }

    document.getElementById("cmRefresh").addEventListener("click", function () { loadComments(true); });
    moreBtn.addEventListener("click", function () { loadComments(false); });
    document.getElementById("cmBanAdd").addEventListener("click", function () {
      var v = banHashEl.value.trim().toLowerCase();
      if (!/^[a-f0-9]{8,64}$/.test(v)) { toast("ip_hash must be 8-64 hex chars"); return; }
      banSender(v, "", function () { banHashEl.value = ""; });
    });

    loadComments(true);
    loadBans();
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
