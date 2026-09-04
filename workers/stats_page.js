// Stats tab for the /admin page (interpolated into ADMIN_PAGE_HTML by
// admin_page.js), reading the first-party analytics collected by
// analytics.js. Self-contained fragment: own <style>, markup and IIFE, so
// admin_page.js only grows by the import + interpolation — the same pattern
// as editor_page.js and ai_page.js. The page's inline script runs inside
// admin_page's template literal, so — same rule as there — it avoids
// backticks and ${} entirely (string concatenation only).
//
// Data comes from GET /admin/api/stats?days=N&self=1 (Access-protected) and
// is rendered as: KPI tiles, a hand-rolled SVG daily trend (crosshair +
// tooltip + table view), top pages / referrers tables, device / browser /
// OS / language / country breakdowns, the per-visitor list with a session
// drill-down dialog, and a recent-visits feed. Series colors are the site
// teal + a blue, validated for CVD separation on both the light and the dark
// admin surfaces; the light teal sits below 3:1 contrast, which the always-
// printed text values and the table views make up for.

export const STATS_TAB_HTML = `
<style>
  #tabStats { --st-s1: #1abc9c; --st-s2: #2a78d6; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) #tabStats { --st-s1: #16a085; --st-s2: #3987e5; }
  }
  :root[data-theme="dark"] #tabStats { --st-s1: #16a085; --st-s2: #3987e5; }

  #tabStats .st-bar {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0 0 16px;
  }
  #tabStats .st-range { display: flex; gap: 0; }
  #tabStats .st-range button { border-radius: 0; margin-left: -1px; }
  #tabStats .st-range button:first-child { border-radius: 8px 0 0 8px; margin-left: 0; }
  #tabStats .st-range button:last-child { border-radius: 0 8px 8px 0; }
  #tabStats .st-range button.active {
    background: var(--color-accent-strong); border-color: var(--color-accent-strong); color: #fff;
  }
  #tabStats .st-self { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--color-text-soft); }
  #tabStats .st-spacer { flex: 1; }
  #tabStats .st-status { font-size: 12px; color: var(--color-text-muted); }

  #tabStats .st-kpis {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 0 0 16px;
  }
  #tabStats .st-tile {
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 12px 14px;
  }
  #tabStats .st-tile .st-label { font-size: 12.5px; color: var(--color-text-muted); }
  #tabStats .st-tile .st-value { font-size: 24px; font-weight: 600; color: var(--color-heading); margin-top: 2px; }

  #tabStats .st-card {
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px;
    padding: 14px; margin: 0 0 16px;
  }
  #tabStats .st-card.stale { opacity: 0.45; transition: opacity 0.15s; }
  #tabStats .st-card h3 { margin: 0 0 10px; font-size: 14.5px; color: var(--color-heading); }
  #tabStats .st-cardhead { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 10px; }
  #tabStats .st-cardhead h3 { margin: 0; }
  #tabStats .st-legend { display: flex; gap: 14px; align-items: center; font-size: 12.5px; color: var(--color-text-soft); }
  #tabStats .st-legend .st-key { display: inline-block; width: 14px; height: 0; border-top: 3px solid; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  #tabStats .st-key.k1 { border-top-color: var(--st-s1); }
  #tabStats .st-key.k2 { border-top-color: var(--st-s2); }

  #tabStats .st-chartwrap { position: relative; }
  #tabStats .st-chart { width: 100%; height: auto; display: block; }
  #tabStats .st-chart text { font-family: inherit; }
  #tabStats .st-tip {
    position: absolute; pointer-events: none; display: none; z-index: 5; min-width: 130px;
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px;
    box-shadow: var(--shadow-card); padding: 7px 10px; font-size: 12.5px;
  }
  #tabStats .st-tip .st-tipdate { color: var(--color-text-muted); margin-bottom: 4px; }
  #tabStats .st-tip .st-tiprow { display: flex; align-items: center; gap: 6px; }
  #tabStats .st-tip .st-tipval { font-weight: 600; color: var(--color-heading); margin-left: auto; font-variant-numeric: tabular-nums; }
  #tabStats .st-tip .st-tipname { color: var(--color-text-soft); }

  #tabStats table { width: 100%; border-collapse: collapse; font-size: 13px; }
  #tabStats th {
    text-align: left; font-weight: 600; color: var(--color-text-muted); font-size: 12px;
    padding: 4px 8px; border-bottom: 1px solid var(--color-border-light); white-space: nowrap;
  }
  #tabStats td { padding: 5px 8px; border-bottom: 1px solid var(--color-border-light); color: var(--color-text); }
  #tabStats tr:last-child td { border-bottom: none; }
  #tabStats th.num, #tabStats td.num { text-align: right; font-variant-numeric: tabular-nums; }
  #tabStats .st-scroll { overflow-x: auto; }
  #tabStats .st-path { word-break: break-all; }
  #tabStats .st-cellbar { position: relative; min-width: 90px; }
  #tabStats .st-cellbar .st-fill {
    position: absolute; left: 4px; top: 6px; bottom: 6px; border-radius: 3px;
    background: var(--st-s1); opacity: 0.28;
  }
  #tabStats .st-cellbar span { position: relative; }
  #tabStats .st-chip {
    display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px;
    border: 1px solid var(--color-border); color: var(--color-text-muted); white-space: nowrap;
  }
  #tabStats .st-mini { font-size: 12px; color: var(--color-text-muted); }
  #tabStats .st-barrow { display: grid; grid-template-columns: minmax(70px, 1fr) 110px 48px; gap: 8px; align-items: center; padding: 3px 0; font-size: 12.5px; }
  #tabStats .st-barrow .st-track { height: 8px; border-radius: 4px; background: var(--color-surface-alt); overflow: hidden; }
  #tabStats .st-barrow .st-track i { display: block; height: 100%; border-radius: 4px; background: var(--st-s1); }
  #tabStats .st-barrow .st-count { text-align: right; color: var(--color-text-soft); font-variant-numeric: tabular-nums; }
  #tabStats .st-barrow .st-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #tabStats .st-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  #tabStats .st-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  @media (max-width: 900px) { #tabStats .st-grid2, #tabStats .st-grid3 { grid-template-columns: 1fr; } }
  #tabStats .st-visitorrow td { cursor: pointer; }
  #tabStats .st-visitorrow:hover td { background: var(--color-surface-alt); }
  #tabStats .st-dur { color: var(--color-text-muted); }
  #tabStats #stVisitor { border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); color: var(--color-text); padding: 18px; max-width: 720px; width: calc(100% - 32px); }
  #tabStats #stVisitor::backdrop { background: rgba(0, 0, 0, .45); }
  #tabStats #stVisitor h3 { margin: 14px 0 8px; font-size: 14px; color: var(--color-heading); }
  #tabStats #stVisitor .st-vhead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  #tabStats #stVisitor .st-vhead code { font-size: 12px; color: var(--color-text-muted); }
</style>
<section id="tabStats" hidden>
  <p class="hint">First-party analytics collected by the site itself — real pageviews only (bots are dropped at ingest). Session = one browser tab; visitor = a pseudonymous IP+UA hash that never stores the IP.</p>

  <div class="st-bar">
    <div class="st-range" role="group" aria-label="Date range">
      <button id="stD7" type="button">7d</button>
      <button id="stD30" type="button" class="active">30d</button>
      <button id="stD90" type="button">90d</button>
    </div>
    <label class="st-self"><input id="stSelf" type="checkbox"> Include my visits</label>
    <span class="st-spacer"></span>
    <span id="stStatus" class="st-status"></span>
    <button id="stRefresh" type="button">↻ Refresh</button>
  </div>

  <div id="stKpis" class="st-kpis"></div>

  <div class="st-card" id="stTrendCard">
    <div class="st-cardhead">
      <h3>Daily pageviews &amp; visitors</h3>
      <span class="st-legend">
        <span><span class="st-key k1"></span>Pageviews</span>
        <span><span class="st-key k2"></span>Visitors</span>
      </span>
      <span class="st-spacer"></span>
      <button id="stTableBtn" type="button" title="Show the same data as a table">Table</button>
    </div>
    <div class="st-chartwrap">
      <div id="stChart" class="st-chart" role="img" aria-label="Daily pageviews and visitors line chart"></div>
      <div id="stTip" class="st-tip"></div>
    </div>
    <div id="stDailyTable" class="st-scroll" hidden></div>
  </div>

  <div class="st-grid2">
    <div class="st-card" id="stPathsCard">
      <h3>Top pages</h3>
      <div class="st-scroll"><table><thead><tr>
        <th>Path</th><th class="num">Views</th><th class="num">Visitors</th><th class="num">Avg. time</th>
      </tr></thead><tbody id="stPathsBody"></tbody></table></div>
    </div>
    <div class="st-card" id="stRefsCard">
      <h3>Where visitors came from</h3>
      <div class="st-scroll"><table><thead><tr>
        <th>Source</th><th></th><th class="num">Visits</th><th class="num">Views</th>
      </tr></thead><tbody id="stRefsBody"></tbody></table></div>
    </div>
  </div>

  <div class="st-grid3">
    <div class="st-card"><h3>Traffic kinds</h3><div id="stKinds"></div></div>
    <div class="st-card"><h3>Devices</h3><div id="stDevices"></div></div>
    <div class="st-card"><h3>Countries</h3><div id="stCountries"></div></div>
    <div class="st-card"><h3>Browsers</h3><div id="stBrowsers"></div></div>
    <div class="st-card"><h3>Operating systems</h3><div id="stOs"></div></div>
    <div class="st-card"><h3>Languages</h3><div id="stLangs"></div></div>
  </div>

  <div class="st-card" id="stVisitorsCard">
    <h3>Visitors (most recently active first)</h3>
    <div class="st-scroll"><table><thead><tr>
      <th>Last seen</th><th>Where</th><th>Device</th><th>Browser · OS</th>
      <th class="num">Views</th><th class="num">Sessions</th><th class="num">First seen</th>
    </tr></thead><tbody id="stVisitorsBody"></tbody></table></div>
    <p class="st-mini" style="margin: 8px 0 0;">Click a row for the visitor's sessions and page timeline.</p>
  </div>

  <div class="st-card" id="stRecentCard">
    <h3>Recent pageviews</h3>
    <div class="st-scroll"><table><thead><tr>
      <th>When</th><th>Path</th><th>From</th><th>Where</th><th>Device</th><th class="num">On page</th>
    </tr></thead><tbody id="stRecentBody"></tbody></table></div>
  </div>

  <dialog id="stVisitor">
    <div class="st-vhead">
      <h2 style="margin: 0;">Visitor</h2>
      <code id="stVId"></code>
      <span class="st-spacer"></span>
      <button id="stVClose" type="button">Close</button>
    </div>
    <p id="stVMeta" class="st-mini" style="margin: 8px 0 0;"></p>
    <h3>Sessions</h3>
    <div class="st-scroll"><table><thead><tr>
      <th>Start</th><th class="num">Pages</th><th class="num">Read time</th><th>Entry → Exit</th><th>From</th>
    </tr></thead><tbody id="stVVisits"></tbody></table></div>
    <h3>Recent pages (latest 150)</h3>
    <div id="stVTimeline" class="st-scroll" style="max-height: 260px; overflow-y: auto;"></div>
  </dialog>
</section>

<script>
(function () {
  "use strict";

  var state = { days: 30, self: false, loaded: false, loading: false, data: null };
  var chartState = null; // rendered daily-series cache for the crosshair

  function $(id) { return document.getElementById(id); }

  function fmtInt(n) { return (n || 0).toLocaleString("en-US"); }

  function fmtPct(x) {
    if (x == null || isNaN(x)) return "—";
    return Math.round(x * 100) + "%";
  }

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
    return Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
  }

  function timeAgo(ts) {
    var d = Math.max(0, Date.now() / 1000 - ts);
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    return Math.floor(d / 86400) + "d ago";
  }

  function fmtWhen(ts) {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }

  function fmtDay(dateStr) {
    var parts = dateStr.split("-");
    return parts[1] + "/" + parts[2];
  }

  // ISO-3166 alpha-2 -> flag emoji (regional indicator symbols).
  function flagOf(cc) {
    if (!cc || cc.length !== 2 || !/^[A-Za-z]{2}$/.test(cc)) return "";
    var out = "";
    for (var i = 0; i < 2; i++) out += String.fromCodePoint(127397 + cc.toUpperCase().charCodeAt(i));
    return out + " ";
  }

  function kindLabel(host, kind) {
    if (!host) return "Direct / internal";
    return host;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function cell(row, text, cls) {
    var td = document.createElement("td");
    if (cls) td.className = cls;
    if (text != null) td.textContent = text;
    row.appendChild(td);
    return td;
  }

  // --- KPI tiles -----------------------------------------------------------

  var KPIS = [
    ["Pageviews", "pv", fmtInt],
    ["Unique visitors", "uv", fmtInt],
    ["Sessions", "sessions", fmtInt],
    ["Bounce rate", "bounce", fmtPct],
    ["Avg. time on page", "avgDuration", fmtDur],
    ["New visitors", "newShare", fmtPct]
  ];

  function renderKpis(summary) {
    var wrap = $("stKpis");
    clear(wrap);
    KPIS.forEach(function (kpi) {
      var tile = document.createElement("div");
      tile.className = "st-tile";
      var label = document.createElement("div");
      label.className = "st-label";
      label.textContent = kpi[0];
      var value = document.createElement("div");
      value.className = "st-value";
      value.textContent = kpi[2](summary[kpi[1]]);
      tile.appendChild(label);
      tile.appendChild(value);
      wrap.appendChild(tile);
    });
  }

  // --- daily trend (SVG) -----------------------------------------------------

  var SVG_NS = "http://www.w3.org/2000/svg";
  var PAD = { l: 46, r: 18, t: 12, b: 26 };
  var W = 760;
  var H = 240;

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function niceScale(maxV) {
    var step = Math.max(1, Math.ceil(maxV / 4));
    return { max: step * 4, step: step };
  }

  function renderTrend(daily) {
    var host = $("stChart");
    clear(host);
    chartState = null;
    if (!daily.length) {
      var note = document.createElement("p");
      note.className = "empty";
      note.textContent = "No pageviews in this range yet.";
      host.appendChild(note);
      return;
    }

    var maxPv = 1;
    daily.forEach(function (d) { maxPv = Math.max(maxPv, d.pv, d.uv); });
    var scale = niceScale(maxPv);
    var plotW = W - PAD.l - PAD.r;
    var plotH = H - PAD.t - PAD.b;

    function xAt(i) { return PAD.l + (daily.length === 1 ? plotW / 2 : (i / (daily.length - 1)) * plotW); }
    function yAt(v) { return PAD.t + plotH - (v / scale.max) * plotH; }

    var svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H,
      width: "100%",
      class: "st-svg"
    });

    // Recessive hairline grid + tick labels (tabular numbers align vertically).
    for (var g = 0; g <= 4; g++) {
      var v = (scale.max / 4) * g;
      var y = yAt(v);
      svg.appendChild(svgEl("line", {
        x1: PAD.l, x2: W - PAD.r, y1: y, y2: y,
        stroke: "var(--color-border-light)", "stroke-width": 1
      }));
      var tick = svgEl("text", {
        x: PAD.l - 8, y: y + 3.5, "text-anchor": "end",
        "font-size": 10, fill: "var(--color-text-muted)",
        style: "font-variant-numeric: tabular-nums"
      });
      tick.textContent = fmtInt(v);
      svg.appendChild(tick);
    }

    // X labels: at most 6, evenly spaced.
    var labelCount = Math.min(6, daily.length);
    var shown = {};
    for (var li = 0; li < labelCount; li++) {
      var idx = Math.round((li / (labelCount - 1 || 1)) * (daily.length - 1));
      if (shown[idx]) continue;
      shown[idx] = true;
      var xt = svgEl("text", {
        x: xAt(idx), y: H - 8, "text-anchor": "middle",
        "font-size": 10, fill: "var(--color-text-muted)"
      });
      xt.textContent = fmtDay(daily[idx].date);
      svg.appendChild(xt);
    }

    function linePoints(getVal) {
      var pts = [];
      daily.forEach(function (d, i) { pts.push(xAt(i) + "," + yAt(getVal(d))); });
      return pts.join(" ");
    }

    // Crosshair hairline (hidden until hover/keyboard focus).
    var cross = svgEl("line", {
      x1: 0, x2: 0, y1: PAD.t, y2: PAD.t + plotH,
      stroke: "var(--color-text-muted)", "stroke-width": 1, visibility: "hidden"
    });
    svg.appendChild(cross);

    [["pv", "var(--st-s1)"], ["uv", "var(--st-s2)"]].forEach(function (series) {
      svg.appendChild(svgEl("polyline", {
        points: linePoints(function (d) { return d[series[0]]; }),
        fill: "none", stroke: series[1],
        "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round"
      }));
      var last = daily[daily.length - 1];
      // End dot with a 2px surface ring so it stays legible over the grid.
      svg.appendChild(svgEl("circle", {
        cx: xAt(daily.length - 1), cy: yAt(last[series[0]]), r: 4,
        fill: series[1], stroke: "var(--color-surface)", "stroke-width": 2
      }));
    });

    svg.appendChild(cross); // crosshair above the lines

    // Hover/keyboard layer: the whole plot is the hit target, snapped to the
    // nearest day — nobody has to land on a 2px line.
    var overlay = svgEl("rect", {
      x: PAD.l, y: PAD.t, width: plotW, height: plotH,
      fill: "transparent", tabindex: 0,
      role: "application",
      "aria-label": "Daily chart. Use left and right arrow keys to read values."
    });
    svg.appendChild(overlay);
    host.appendChild(svg);

    var tip = $("stTip");
    var hoverIdx = -1;

    function showAt(i) {
      i = Math.max(0, Math.min(daily.length - 1, i));
      hoverIdx = i;
      var d = daily[i];
      var x = xAt(i);
      cross.setAttribute("x1", x);
      cross.setAttribute("x2", x);
      cross.setAttribute("visibility", "visible");

      clear(tip);
      var dateLine = document.createElement("div");
      dateLine.className = "st-tipdate";
      dateLine.textContent = d.date;
      tip.appendChild(dateLine);
      [["Pageviews", d.pv, "k1"], ["Visitors", d.uv, "k2"], ["Sessions", d.sessions, ""]].forEach(function (rowDef) {
        var row = document.createElement("div");
        row.className = "st-tiprow";
        if (rowDef[2]) {
          var key = document.createElement("span");
          key.className = "st-key " + rowDef[2];
          row.appendChild(key);
        }
        var name = document.createElement("span");
        name.className = "st-tipname";
        name.textContent = rowDef[0];
        var val = document.createElement("span");
        val.className = "st-tipval";
        val.textContent = fmtInt(rowDef[1]);
        row.appendChild(name);
        row.appendChild(val);
        tip.appendChild(row);
      });
      tip.style.display = "block";
      var wrapRect = host.getBoundingClientRect();
      var px = (x / W) * wrapRect.width;
      var tipW = tip.offsetWidth || 140;
      var left = px + 12;
      if (left + tipW > wrapRect.width - 4) left = px - tipW - 12;
      tip.style.left = Math.max(2, left) + "px";
      tip.style.top = "8px";
    }

    function hide() {
      hoverIdx = -1;
      cross.setAttribute("visibility", "hidden");
      tip.style.display = "none";
    }

    overlay.addEventListener("pointermove", function (e) {
      var rect = host.getBoundingClientRect();
      var relX = ((e.clientX - rect.left) / rect.width) * W;
      var frac = (relX - PAD.l) / plotW;
      showAt(Math.round(frac * (daily.length - 1)));
    });
    overlay.addEventListener("pointerleave", hide);
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { showAt(hoverIdx < 0 ? daily.length - 1 : hoverIdx + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { showAt(hoverIdx < 0 ? daily.length - 1 : hoverIdx - 1); e.preventDefault(); }
      else if (e.key === "Home") { showAt(0); e.preventDefault(); }
      else if (e.key === "End") { showAt(daily.length - 1); e.preventDefault(); }
      else if (e.key === "Escape") hide();
    });
    overlay.addEventListener("focus", function () { showAt(daily.length - 1); });
    overlay.addEventListener("blur", hide);

    chartState = { daily: daily };
  }

  function renderDailyTable(daily) {
    var wrap = $("stDailyTable");
    clear(wrap);
    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["Date", "Pageviews", "Visitors", "Sessions"].forEach(function (h, i) {
      var th = document.createElement("th");
      th.textContent = h;
      if (i > 0) th.className = "num";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    daily.forEach(function (d) {
      var row = document.createElement("tr");
      cell(row, d.date);
      cell(row, fmtInt(d.pv), "num");
      cell(row, fmtInt(d.uv), "num");
      cell(row, fmtInt(d.sessions), "num");
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  // --- tables & breakdowns ---------------------------------------------------

  function renderPaths(paths) {
    var body = $("stPathsBody");
    clear(body);
    var maxPv = 1;
    paths.forEach(function (p) { maxPv = Math.max(maxPv, p.pv); });
    paths.forEach(function (p) {
      var row = document.createElement("tr");
      var pathTd = cell(row, null, "st-path");
      pathTd.textContent = p.path;
      pathTd.title = p.path;
      var pvTd = cell(row, null, "num st-cellbar");
      var fill = document.createElement("i");
      fill.className = "st-fill";
      fill.style.width = Math.max(2, Math.round((p.pv / maxPv) * 100)) + "%";
      var span = document.createElement("span");
      span.textContent = fmtInt(p.pv);
      pvTd.appendChild(fill);
      pvTd.appendChild(span);
      cell(row, fmtInt(p.uv), "num");
      cell(row, p.avg_dur ? fmtDur(p.avg_dur) : "—", "num st-dur");
      body.appendChild(row);
    });
    if (!paths.length) body.appendChild(emptyRow(4, "No pageviews yet."));
  }

  function renderRefs(referrers) {
    var body = $("stRefsBody");
    clear(body);
    referrers.forEach(function (r) {
      var row = document.createElement("tr");
      cell(row, kindLabel(r.ref_host, r.ref_kind));
      var chipTd = cell(row, null);
      var chip = document.createElement("span");
      chip.className = "st-chip";
      chip.textContent = r.ref_kind;
      chipTd.appendChild(chip);
      cell(row, fmtInt(r.visits), "num");
      cell(row, fmtInt(r.pv), "num");
      body.appendChild(row);
    });
    if (!referrers.length) body.appendChild(emptyRow(4, "No referrer data yet."));
  }

  // Generic "name + proportional bar + count" row list. widthOf maps a row to
  // its 0..1 bar fraction and countOf to the printed numbers, so panels with
  // different shapes (kinds have visits; the rest have uv + pv) share it.
  function renderBars(nodeId, rows, nameOf, widthOf, countOf) {
    var host = $(nodeId);
    clear(host);
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, widthOf(r)); });
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "st-barrow";
      var name = document.createElement("span");
      name.className = "st-name";
      name.textContent = nameOf(r);
      name.title = nameOf(r);
      var track = document.createElement("span");
      track.className = "st-track";
      var fill = document.createElement("i");
      fill.style.width = Math.max(2, Math.round((widthOf(r) / max) * 100)) + "%";
      track.appendChild(fill);
      var count = document.createElement("span");
      count.className = "st-count";
      count.textContent = countOf(r);
      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(count);
      host.appendChild(row);
    });
    if (!rows.length) {
      var note = document.createElement("p");
      note.className = "empty";
      note.textContent = "No data yet.";
      host.appendChild(note);
    }
  }

  function emptyRow(cols, text) {
    var row = document.createElement("tr");
    var td = cell(row, text);
    td.colSpan = cols;
    td.className = "st-mini";
    return row;
  }

  function renderVisitors(visitors) {
    var body = $("stVisitorsBody");
    clear(body);
    visitors.forEach(function (v) {
      var row = document.createElement("tr");
      row.className = "st-visitorrow";
      cell(row, timeAgo(v.last_seen));
      cell(row, (flagOf(v.country) || "—") + (v.country || ""));
      cell(row, v.device || "—");
      cell(row, (v.browser || "?") + " · " + (v.os || "?"));
      cell(row, fmtInt(v.hits), "num");
      cell(row, fmtInt(v.sessions), "num");
      cell(row, timeAgo(v.first_seen), "num st-mini");
      row.title = v.visitor_id + " — last path " + v.last_path;
      row.addEventListener("click", function () { openVisitor(v.visitor_id); });
      body.appendChild(row);
    });
    if (!visitors.length) body.appendChild(emptyRow(7, "No visitors in this range yet."));
  }

  function renderRecent(recent) {
    var body = $("stRecentBody");
    clear(body);
    recent.forEach(function (r) {
      var row = document.createElement("tr");
      cell(row, fmtWhen(r.ts), "st-mini");
      var pathTd = cell(row, r.path, "st-path");
      pathTd.title = r.path;
      var fromTd = cell(row, null);
      fromTd.textContent = kindLabel(r.ref_host, r.ref_kind);
      if (r.ref_host) {
        var chip = document.createElement("span");
        chip.className = "st-chip";
        chip.textContent = r.ref_kind;
        chip.style.marginLeft = "6px";
        fromTd.appendChild(chip);
      }
      cell(row, (flagOf(r.country) || "—") + (r.country || ""));
      cell(row, r.device || "—");
      cell(row, r.duration ? fmtDur(r.duration) : "—", "num st-dur");
      body.appendChild(row);
    });
    if (!recent.length) body.appendChild(emptyRow(6, "No pageviews yet."));
  }

  // --- visitor drill-down ------------------------------------------------------

  function openVisitor(id) {
    var dialog = $("stVisitor");
    $("stVId").textContent = id;
    clear($("stVMeta"));
    clear($("stVVisits"));
    clear($("stVTimeline"));
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();

    fetch("/admin/api/visitor?id=" + encodeURIComponent(id))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) { $("stVMeta").textContent = data.error; return; }
        var v = data.visitor || {};
        $("stVMeta").textContent = [
          "First seen " + timeAgo(v.first_seen || 0),
          "last active " + timeAgo(v.last_seen || 0),
          (flagOf(v.country) || "") + (v.country || "unknown country"),
          (v.device || "?") + " · " + (v.browser || "?") + " · " + (v.os || "?"),
          v.lang || "?", v.tz || ""
        ].filter(Boolean).join("  ·  ");

        var visitsBody = $("stVVisits");
        clear(visitsBody);
        (data.visits || []).forEach(function (s) {
          var row = document.createElement("tr");
          cell(row, fmtWhen(s.start_ts), "st-mini");
          cell(row, fmtInt(s.hits), "num");
          cell(row, s.duration ? fmtDur(s.duration) : "—", "num st-dur");
          var nav = document.createElement("td");
          nav.className = "st-path";
          nav.textContent = s.entry_path + "  →  " + s.exit_path;
          row.appendChild(nav);
          var fromTd = cell(row, null);
          fromTd.textContent = kindLabel(s.ref_host, s.ref_kind);
          visitsBody.appendChild(row);
        });
        if (!(data.visits || []).length) visitsBody.appendChild(emptyRow(5, "No sessions recorded."));

        var timeline = $("stVTimeline");
        clear(timeline);
        var hits = (data.timeline || []).slice().reverse(); // chronological
        hits.forEach(function (h) {
          var line = document.createElement("div");
          line.className = "st-barrow";
          line.style.gridTemplateColumns = "110px 1fr 60px";
          var when = document.createElement("span");
          when.className = "st-mini";
          when.textContent = fmtWhen(h.ts);
          var path = document.createElement("span");
          path.className = "st-name";
          path.textContent = h.path;
          path.title = h.path;
          var dur = document.createElement("span");
          dur.className = "st-count";
          dur.textContent = h.duration ? fmtDur(h.duration) : "";
          line.appendChild(when);
          line.appendChild(path);
          line.appendChild(dur);
          timeline.appendChild(line);
        });
        if (!hits.length) {
          var note = document.createElement("p");
          note.className = "empty";
          note.textContent = "No pageviews recorded.";
          timeline.appendChild(note);
        }
      })
      .catch(function () { $("stVMeta").textContent = "Could not load the visitor."; });
  }

  // --- data loading ------------------------------------------------------------

  function setRangeButtons() {
    [["stD7", 7], ["stD30", 30], ["stD90", 90]].forEach(function (pair) {
      $(pair[0]).className = state.days === pair[1] ? "active" : "";
    });
  }

  function load() {
    if (state.loading) return;
    state.loading = true;
    $("stStatus").textContent = "Loading…";
    ["stTrendCard", "stPathsCard", "stRefsCard", "stVisitorsCard", "stRecentCard"].forEach(function (id) {
      $(id).classList.add("stale");
    });
    fetch("/admin/api/stats?days=" + state.days + "&self=" + (state.self ? "1" : "0"))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        state.data = data;
        state.loaded = true;
        renderKpis(data.summary);
        renderTrend(data.daily);
        renderDailyTable(data.daily);
        renderPaths(data.paths);
        renderRefs(data.referrers);
        renderBars("stKinds", data.refKinds,
          function (r) { return r.ref_kind || "direct"; },
          function (r) { return r.visits || 0; },
          function (r) { return fmtInt(r.visits) + " visits"; });
        renderBars("stDevices", data.devices,
          function (r) { return r.name || "unknown"; },
          function (r) { return r.uv || 0; },
          function (r) { return fmtInt(r.uv) + " uv · " + fmtInt(r.pv) + " pv"; });
        renderBars("stCountries", data.countries,
          function (r) { return flagOf(r.country) + (r.country || "unknown"); },
          function (r) { return r.uv || 0; },
          function (r) { return fmtInt(r.uv) + " uv · " + fmtInt(r.pv) + " pv"; });
        renderBars("stBrowsers", data.browsers,
          function (r) { return r.name || "unknown"; },
          function (r) { return r.uv || 0; },
          function (r) { return fmtInt(r.uv) + " uv · " + fmtInt(r.pv) + " pv"; });
        renderBars("stOs", data.os,
          function (r) { return r.name || "unknown"; },
          function (r) { return r.uv || 0; },
          function (r) { return fmtInt(r.uv) + " uv · " + fmtInt(r.pv) + " pv"; });
        renderBars("stLangs", data.langs,
          function (r) { return r.name || "unknown"; },
          function (r) { return r.uv || 0; },
          function (r) { return fmtInt(r.uv) + " uv · " + fmtInt(r.pv) + " pv"; });
        renderVisitors(data.visitors);
        renderRecent(data.recent);
        $("stStatus").textContent = "Updated " + new Date().toLocaleTimeString();
      })
      .catch(function (err) {
        $("stStatus").textContent = err && err.message ? String(err.message) : "Could not load stats";
      })
      .then(function () {
        state.loading = false;
        ["stTrendCard", "stPathsCard", "stRefsCard", "stVisitorsCard", "stRecentCard"].forEach(function (id) {
          $(id).classList.remove("stale");
        });
      });
  }

  // The tab starts hidden; the first activation triggers the first fetch.
  document.getElementById("tabBtnStats").addEventListener("click", function () {
    if (!state.loaded) load();
  });
  $("stD7").addEventListener("click", function () { state.days = 7; setRangeButtons(); load(); });
  $("stD30").addEventListener("click", function () { state.days = 30; setRangeButtons(); load(); });
  $("stD90").addEventListener("click", function () { state.days = 90; setRangeButtons(); load(); });
  $("stSelf").addEventListener("change", function (e) { state.self = e.target.checked; load(); });
  $("stRefresh").addEventListener("click", load);
  $("stTableBtn").addEventListener("click", function () {
    var showTable = $("stDailyTable").hidden;
    $("stDailyTable").hidden = !showTable;
    $("stChart").hidden = showTable;
    this.textContent = showTable ? "Chart" : "Table";
  });
  $("stVClose").addEventListener("click", function () { $("stVisitor").close(); });

  setRangeButtons();
})();
</script>
`;
