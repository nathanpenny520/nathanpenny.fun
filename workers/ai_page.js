// AI playground tab for the /admin page (interpolated into ADMIN_PAGE_HTML by
// admin_page.js). Self-contained fragment: own <style>, markup and IIFE, so
// admin_page.js only grows by the import + interpolation. The page's inline
// script runs inside admin_page's template literal, so — same rule as there —
// it avoids backticks and ${} entirely, and every backslash in page-side
// regex/string escapes is doubled here (\\n -> \n on the page).
//
// The tab talks to the Worker's own /api/ai/v1 (bearer npai_ keys, free
// Workers AI models). The key is kept in this browser's localStorage only —
// it is never sent anywhere except the proxy itself, and the page is
// Access-gated.

export const AI_TAB_HTML = `
<style>
  #tabAi .ai-settings {
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px;
    padding: 12px; margin: 0 0 12px; display: grid; gap: 10px;
  }
  #tabAi .ai-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  #tabAi input, #tabAi select {
    font: inherit; font-size: 13px; padding: 6px 9px;
    border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text);
  }
  #tabAi .ai-row input[type="password"] { flex: 1 1 220px; }
  #tabAi select { min-width: 250px; }
  #tabAi .ai-chat-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 0 0 10px; }
  #tabAi #aiHistSel { flex: 1 1 220px; min-width: 0; }
  #aiChat .empty { margin: auto; text-align: center; }
  #aiChat {
    display: flex; flex-direction: column; gap: 10px;
    height: min(56vh, 460px); overflow-y: auto;
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px;
    padding: 14px; margin: 0 0 10px;
  }
  .ai-msg { max-width: 85%; }
  .ai-msg.user { align-self: flex-end; }
  .ai-msg.assistant { align-self: flex-start; }
  .ai-who { font-size: 11.5px; color: var(--color-text-muted); margin: 0 0 3px 2px; }
  .ai-msg.user .ai-who { text-align: right; }
  .ai-text {
    white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.55;
    background: var(--color-surface-alt); border: 1px solid var(--color-border);
    border-radius: 12px; padding: 8px 12px;
  }
  .ai-msg.user .ai-text { background: var(--color-accent-strong); border-color: var(--color-accent-strong); color: #fff; }
  .ai-text.err { color: var(--color-danger); background: var(--color-surface); }
  .ai-form { display: flex; gap: 8px; }
  #aiInput { flex: 1 1 auto; }
  .ai-note { font-size: 12.5px; color: var(--color-text-muted); margin: 10px 0 0; }
</style>
<section id="tabAi" hidden>
  <p class="hint">AI playground over your own proxy (/api/ai/v1) — free Workers&nbsp;AI models, billed in Neurons (10k/day free). The key lives in this browser only (localStorage).</p>

  <div class="ai-settings">
    <div class="ai-row">
      <input id="aiKey" type="password" placeholder="npai_… API key" autocomplete="off">
      <button id="aiKeySave" class="primary" type="button">Save key</button>
      <button id="aiKeyClear" type="button">Forget</button>
      <span id="aiKeyStatus" class="status"></span>
    </div>
    <div class="ai-row">
      <label class="meta" for="aiModel">Model</label>
      <select id="aiModel" aria-label="Model"></select>
      <button id="aiReloadModels" type="button" title="Reload model list">↻</button>
    </div>
  </div>

  <div class="ai-chat-bar">
    <button id="aiNewChat" type="button" class="primary">+ New chat</button>
    <select id="aiHistSel" aria-label="Saved conversations"></select>
    <button id="aiDelChat" type="button" class="danger" title="Delete the selected conversation">Delete</button>
  </div>

  <div id="aiChat" aria-live="polite"></div>

  <form id="aiForm" class="ai-form">
    <input id="aiInput" type="text" placeholder="Message… (Enter to send)" autocomplete="off" maxlength="4000">
    <button id="aiSend" class="primary" type="submit">Send</button>
    <button id="aiStop" type="button" hidden>Stop</button>
  </form>
  <p class="ai-note">Streaming SSE passthrough · every call is logged (metadata only) and counts toward the key's monthly cap. Create keys with <code>python3 tools/ai_key.py &lt;name&gt; [monthly_limit]</code>.</p>
</section>
<script>
(function () {
  "use strict";

  var KEY_STORAGE = "np-admin-ai-key";
  var keyInput = document.getElementById("aiKey");
  var keyStatus = document.getElementById("aiKeyStatus");
  var modelSel = document.getElementById("aiModel");
  var chatEl = document.getElementById("aiChat");
  var form = document.getElementById("aiForm");
  var input = document.getElementById("aiInput");
  var sendBtn = document.getElementById("aiSend");
  var stopBtn = document.getElementById("aiStop");
  var newChatBtn = document.getElementById("aiNewChat");
  var histSel = document.getElementById("aiHistSel");
  var delChatBtn = document.getElementById("aiDelChat");
  var controller = null;

  // --- conversation history (localStorage only, this browser) -------------
  var CHATS_KEY = "np-admin-ai-chats";
  var CUR_KEY = "np-admin-ai-chat-cur";
  var MAX_CHATS = 50;
  var chats = loadChats();   // [{id, title, ts, messages:[{role, content}…]}], newest first
  var curId = null;          // id of the open conversation (null = unsent new chat)
  var history = [];          // messages of the open conversation

  function loadChats() {
    try {
      var raw = JSON.parse(localStorage.getItem(CHATS_KEY) || "[]");
      if (Array.isArray(raw)) return raw;
    } catch (e) { /* corrupt or blocked storage */ }
    return [];
  }
  function saveChats() {
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
      if (curId) localStorage.setItem(CUR_KEY, curId);
      else localStorage.removeItem(CUR_KEY);
    } catch (e) { /* private mode etc. */ }
  }
  function currentChat() {
    for (var i = 0; i < chats.length; i++) {
      if (chats[i].id === curId) return chats[i];
    }
    return null;
  }

  function getKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (e) { return ""; }
  }
  function setKey(value) {
    try {
      if (value) localStorage.setItem(KEY_STORAGE, value);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (e) {}
  }
  function status(msg, ok) {
    keyStatus.textContent = msg;
    keyStatus.className = "status" + (ok ? " ok" : " err");
  }
  function scrollDown() { chatEl.scrollTop = chatEl.scrollHeight; }

  // Models often open their reply with blank lines; with pre-wrap those
  // render as an empty first line inside the bubble. Trim them for display
  // only — the raw text is what gets stored and re-sent as context.
  function displayText(text) {
    return String(text).replace(/^\\n+/, "");
  }

  function addBubble(role, text) {
    var div = document.createElement("div");
    div.className = "ai-msg " + role;
    var who = document.createElement("div");
    who.className = "ai-who";
    who.textContent = role === "user" ? "You" : "AI";
    var body = document.createElement("div");
    body.className = "ai-text";
    body.textContent = displayText(text);
    div.appendChild(who);
    div.appendChild(body);
    chatEl.appendChild(div);
    scrollDown();
    return body;
  }

  function loadModels() {
    var key = getKey();
    modelSel.textContent = "";
    var placeholder = document.createElement("option");
    if (!key) {
      placeholder.value = "";
      placeholder.textContent = "Save a key to list models";
      modelSel.appendChild(placeholder);
      return;
    }
    placeholder.value = "";
    placeholder.textContent = "Loading…";
    modelSel.appendChild(placeholder);
    fetch("/api/ai/v1/models", { headers: { Authorization: "Bearer " + key } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var models = (data && data.data) || [];
        modelSel.textContent = "";
        if (!models.length) {
          placeholder.value = "";
          placeholder.textContent = "No models available";
          modelSel.appendChild(placeholder);
          return;
        }
        models.forEach(function (m) {
          var o = document.createElement("option");
          o.value = m.id;
          o.textContent = m.id;
          modelSel.appendChild(o);
        });
      })
      .catch(function (err) {
        modelSel.textContent = "";
        placeholder.value = "";
        placeholder.textContent = "Could not load models (" + (err && err.message ? err.message : "error") + ")";
        modelSel.appendChild(placeholder);
      });
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    stopBtn.hidden = !busy;
    input.disabled = busy;
    updateChatBar();
  }

  // --- conversation bar ---------------------------------------------------

  function updateChatBar() {
    var busy = !!controller;
    histSel.value = curId || "";
    newChatBtn.disabled = busy;
    histSel.disabled = busy || !chats.length;
    delChatBtn.disabled = busy || !currentChat();
  }

  function renderHistory() {
    histSel.textContent = "";
    if (!chats.length) {
      var o = document.createElement("option");
      o.value = "";
      o.textContent = "No saved conversations";
      histSel.appendChild(o);
    } else {
      if (!currentChat()) {
        var o0 = document.createElement("option");
        o0.value = "";
        o0.textContent = "New chat (not saved yet)";
        histSel.appendChild(o0);
      }
      chats.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.id;
        var d = new Date(c.ts || 0);
        o.textContent = (c.title || "Untitled") + " · " + d.getFullYear() + "-" +
          String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        histSel.appendChild(o);
      });
    }
    updateChatBar();
  }

  function redrawChat() {
    chatEl.textContent = "";
    if (!history.length) {
      var hint = document.createElement("div");
      hint.className = "empty";
      hint.textContent = "New conversation — messages stay in this browser.";
      chatEl.appendChild(hint);
      return;
    }
    for (var i = 0; i < history.length; i++) {
      addBubble(history[i].role, history[i].content);
    }
  }

  function openChat(id) {
    for (var i = 0; i < chats.length; i++) {
      if (chats[i].id === id) {
        curId = id;
        history = chats[i].messages;
        redrawChat();
        renderHistory();
        saveChats();
        return;
      }
    }
  }

  function newChat() {
    curId = null;
    history = [];
    redrawChat();
    renderHistory();
    saveChats();
    input.focus();
  }

  function deleteCurrentChat() {
    var c = currentChat();
    if (!c) return;
    if (!window.confirm('Delete "' + c.title + '"? This cannot be undone.')) return;
    chats = chats.filter(function (x) { return x.id !== curId; });
    curId = null;
    history = [];
    saveChats();
    redrawChat();
    renderHistory();
  }

  // Store a finished exchange in the open conversation, creating it (and
  // titling it from the first message) on the fly.
  function persistExchange(message, acc) {
    var chat = currentChat();
    if (!chat) {
      chat = {
        id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        title: message.length > 42 ? message.slice(0, 42) + "…" : (message || "Untitled"),
        ts: Date.now(),
        messages: []
      };
      chats.unshift(chat);
      curId = chat.id;
      history = chat.messages;
    }
    chat.messages.push({ role: "user", content: message }, { role: "assistant", content: acc });
    chat.ts = Date.now();
    chats.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    saveChats();
    renderHistory();
  }

  function send(message) {
    var key = getKey();
    if (!key) { status("Save an API key first", false); return; }
    var model = modelSel.value;
    if (!model) { status("Pick a model first", false); return; }
    status("", true);
    addBubble("user", message);
    var bubble = addBubble("assistant", "");
    var acc = "";
    controller = new AbortController();
    setBusy(true);
    fetch("/api/ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: model,
        stream: true,
        // Cap the context window, not the stored conversation.
        messages: history.slice(-16).concat([{ role: "user", content: message }])
      }),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = t || "HTTP " + res.status;
          try { msg = JSON.parse(t).error.message; } catch (e) {}
          throw new Error(msg);
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += decoder.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\\n\\n")) !== -1) {
            var line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (line.indexOf("data:") !== 0) continue;
            var payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            try {
              var j = JSON.parse(payload);
              var delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (delta) { acc += delta; bubble.textContent = displayText(acc); scrollDown(); }
            } catch (e) {}
          }
          return pump();
        });
      }
      return pump();
    }).then(function () {
      if (acc) persistExchange(message, acc);
    }).catch(function (err) {
      if (err && err.name === "AbortError") {
        bubble.textContent = acc ? displayText(acc) + "\\n[stopped]" : "[stopped]";
        if (acc) persistExchange(message, acc);
      } else {
        bubble.textContent = "⚠ " + (err && err.message ? err.message : "Request failed");
        bubble.className = "ai-text err";
      }
    }).then(function () {
      controller = null;
      setBusy(false);
      input.focus();
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var message = input.value.trim();
    if (!message || sendBtn.disabled) return;
    input.value = "";
    send(message);
  });
  stopBtn.addEventListener("click", function () {
    if (controller) controller.abort();
  });
  document.getElementById("aiKeySave").addEventListener("click", function () {
    var v = keyInput.value.trim();
    if (!v) { status("Paste a key first", false); return; }
    setKey(v);
    keyInput.value = "";
    status("Key saved in this browser ✓", true);
    loadModels();
  });
  document.getElementById("aiKeyClear").addEventListener("click", function () {
    setKey("");
    status("Key forgotten", true);
    loadModels();
  });
  document.getElementById("aiReloadModels").addEventListener("click", loadModels);

  newChatBtn.addEventListener("click", newChat);
  histSel.addEventListener("change", function () {
    if (histSel.value) openChat(histSel.value);
    else if (curId) newChat(); // the "New chat (not saved yet)" placeholder row
  });
  delChatBtn.addEventListener("click", deleteCurrentChat);

  if (getKey()) {
    status("Key loaded from this browser ✓", true);
  }
  loadModels();

  // Restore the last open conversation (or start a fresh unsent chat).
  try { curId = localStorage.getItem(CUR_KEY) || null; } catch (e) { curId = null; }
  if (curId && !currentChat()) curId = null;
  var restored = currentChat();
  history = restored ? restored.messages : [];
  redrawChat();
  renderHistory();
})();
</script>
`;
