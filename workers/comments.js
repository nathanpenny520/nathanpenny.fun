// Cloudflare Worker backend: comments, private image uploader, AI proxy.
// Public:
//   GET  /comments  list comments (email deliberately excluded)
//   POST /comments  create a comment (per-IP rate limit + Turnstile)
//   POST /api/ai/v1/chat/completions  OpenAI-compatible proxy (bearer key)
//   GET  /api/ai/v1/models            model catalog (bearer key)
// Cloudflare Access-protected (see access.js):
//   GET    /admin               admin page: image uploader + markdown editor
//   POST   /upload              multipart images -> R2 img/ prefix
//   GET    /upload?list=1       recent uploads
//   DELETE /upload?key=…        remove one object (img/ prefix only)
//   GET    /admin/api/posts     list posts/*.md from GitHub (editor.js)
//   GET    /admin/api/post?slug=…   read one post (editor.js)
//   POST   /admin/api/post      publish/create/update a post (GitHub Contents API)
//   DELETE /admin/api/post      delete a post (slug + sha query params)

import { ADMIN_PAGE_HTML } from "./admin_page.js";
import { handleAi } from "./ai_proxy.js";
import { handleEditor } from "./editor.js";
import { verifyAccess, accessDenied } from "./access.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// Turnstile server-side verification for POST /comments.
const TURNSTILE_ACTION = "comment";
// Production frontends only — never include localhost here.
const TURNSTILE_HOSTNAMES = new Set([
  "nathanpenny.fun",
  "blog.nathanpenny.fun",
  "nathanpenny520.github.io"
]);

// Reject oversized payloads early so the database cannot be flooded.
const MAX_LENGTHS = { name: 50, email: 200, content: 2000 };

// POST /comments rate limit: per-IP counters in the comment_rate D1 table.
// (The Workers rate-limit binding is silently a no-op on this account, so
// the cap lives in D1 instead — one upsert per attempt, window-aligned.)
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 5;
// Old counter rows are swept opportunistically on every POST.
const RATE_WINDOW_KEEP = 10;  // keep the last N windows

function hasInvalidLength(fields) {
  return Object.entries(MAX_LENGTHS).some(
    ([field, max]) => fields[field] !== undefined && String(fields[field]).length > max
  );
}

// Returns true only when the token is present, single-use fresh, solved for
// the expected action, and produced on an approved frontend hostname.
// The secret lives in the Worker secret store: `wrangler secret put TURNSTILE_SECRET`.
async function verifyTurnstile(env, token) {
  if (!env.TURNSTILE_SECRET) return false;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token
      })
    });
    if (!response.ok) return false;

    const result = await response.json();
    return result.success === true
      && result.action === TURNSTILE_ACTION
      && TURNSTILE_HOSTNAMES.has(result.hostname);
  } catch (error) {
    return false;
  }
}

// Count this attempt against the caller's current window. Returns false when
// the window's budget is exhausted. Fail open on D1 trouble: a broken limiter
// must not take comments down — Turnstile still guards the write path.
async function checkRateLimit(env, ip, nowMs) {
  try {
    const nowSeconds = Math.floor(nowMs / 1000);
    const windowStart = nowSeconds - (nowSeconds % RATE_WINDOW_SECONDS);

    const row = await env.DB.prepare(
      `INSERT INTO comment_rate (ip, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT (ip, window_start) DO UPDATE SET count = count + 1
       RETURNING count`
    ).bind(ip, windowStart).first();

    // Opportunistic sweep of long-expired windows (PK-indexed, cheap).
    if (row && row.count === 1) {
      await env.DB.prepare(
        "DELETE FROM comment_rate WHERE window_start < ?"
      ).bind(windowStart - RATE_WINDOW_KEEP * RATE_WINDOW_SECONDS).run();
    }

    return (row ? row.count : 1) <= RATE_MAX_PER_WINDOW;
  } catch (error) {
    return true;
  }
}

// ---------------------------------------------------------------------------
// New-comment owner notification (Email Service). The NOTIFY send_email
// binding pins the single allowed recipient (destination_address in
// wrangler.jsonc) — sends to a verified destination address are free on
// every plan. Privacy: name + 300-char excerpt only, never the commenter's
// email, IP or the full text.
// ---------------------------------------------------------------------------

function sendNotifyEmail(env, name, content) {
  if (!env.NOTIFY) return null; // binding not deployed — feature is off
  const excerpt = String(content).slice(0, 300);
  return env.NOTIFY.send({
    // `to` is omitted on purpose: the binding's destination_address is used.
    from: { email: "noreply@nathanpenny.fun", name: "nathanpenny.fun" },
    subject: `New comment from ${String(name).slice(0, 50)}`,
    text: `New comment on nathanpenny.fun\n\nFrom: ${name}\n\n${excerpt}`
  }).catch((error) => {
    // A failed notification must never affect the comment response.
    console.error("notify email failed:", error && (error.code || error.message));
  });
}

// ---------------------------------------------------------------------------
// Image uploader (Cloudflare Access-protected)
// ---------------------------------------------------------------------------

// Allowed upload types: extension -> MIME. Keys land under img/YYYY/MM/ as an
// ASCII slug + 6 hex chars, which also makes the WAF `...` path trap (see
// tools/upload_music_r2.sh) structurally impossible: slugify removes dots.
const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml"
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const STORAGE_PUBLIC_ORIGIN = "https://storage.nathanpenny.fun/";

// --- Upload handling ---------------------------------------------------------

function slugifyFilename(name) {
  const base = String(name).replace(/\.[^.]+$/, "");
  const slug = base
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "image";
}

function imageKeyFor(filename, ext) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const rand = [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `img/${yyyy}/${mm}/${slugifyFilename(filename)}-${rand}.${ext}`;
}

// Light magic-byte sniffing so a renamed payload cannot pose as an image
// (best effort: svg is checked as text, the rest by signature).
function magicBytesMatch(bytes, ext) {
  const b = new Uint8Array(bytes);
  if (ext === "svg") {
    const head = new TextDecoder().decode(b.subarray(0, 256)).trim().toLowerCase();
    return head.startsWith("<?xml") || head.startsWith("<svg");
  }
  if (ext === "png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === "jpg" || ext === "jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === "gif") return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46; // "GIF"
  if (ext === "webp") {
    return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 // "RIFF"
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50; // "WEBP"
  }
  if (ext === "avif") return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // "ftyp"
  return false;
}

async function handleUploadPost(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (error) {
    return new Response(JSON.stringify({ error: "Expected multipart/form-data" }), { status: 400, headers: JSON_HEADERS });
  }

  const files = [...form.getAll("files")].filter((f) => typeof f !== "string");
  if (!files.length) {
    return new Response(JSON.stringify({ error: "No files under the 'files' field" }), { status: 400, headers: JSON_HEADERS });
  }
  if (files.length > 10) {
    return new Response(JSON.stringify({ error: "Too many files (10 per request maximum)" }), { status: 400, headers: JSON_HEADERS });
  }

  const uploaded = [];
  const failed = [];
  for (const file of files) {
    try {
      if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: larger than 25MB`);
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const contentType = IMAGE_TYPES[ext];
      if (!contentType) throw new Error(`${file.name}: unsupported type`);
      const head = await file.slice(0, 256).arrayBuffer();
      if (!magicBytesMatch(head, ext)) throw new Error(`${file.name}: content does not look like ${ext}`);

      const key = imageKeyFor(file.name, ext);
      await env.R2.put(key, file, {
        httpMetadata: {
          contentType,
          // Date + random names are never overwritten, so cache forever.
          cacheControl: "public, max-age=31536000, immutable"
        }
      });
      const url = STORAGE_PUBLIC_ORIGIN + key;
      uploaded.push({
        key,
        url,
        markdown: `![${file.name.replace(/\.[^.]+$/, "")}](${url})`,
        size: file.size,
        contentType
      });
    } catch (error) {
      failed.push(String(error.message || error));
    }
  }

  return new Response(
    JSON.stringify({ uploaded, failed }),
    { status: uploaded.length ? 200 : 400, headers: JSON_HEADERS }
  );
}

async function handleUploadList(env, url) {
  const options = { prefix: "img/", limit: 100 };
  const cursor = url.searchParams.get("cursor");
  if (cursor) options.cursor = cursor;
  const listing = await env.R2.list(options);
  // R2 lists lexicographically ascending; date-prefixed keys make the reverse
  // of that newest-first.
  const objects = (listing.objects || [])
    .map((o) => ({
      key: o.key,
      url: STORAGE_PUBLIC_ORIGIN + o.key,
      size: o.size,
      uploaded: o.uploaded ? o.uploaded.toISOString() : null
    }))
    .reverse();
  return new Response(
    JSON.stringify({ objects, truncated: !!listing.truncated, cursor: listing.truncated ? listing.cursor : null }),
    { headers: JSON_HEADERS }
  );
}

async function handleUploadDelete(env, url) {
  const key = url.searchParams.get("key") || "";
  if (!key.startsWith("img/") || key.includes("..")) {
    return new Response(JSON.stringify({ error: "Only img/ objects can be deleted" }), { status: 400, headers: JSON_HEADERS });
  }
  await env.R2.delete(key);
  return new Response(JSON.stringify({ success: true }), { headers: JSON_HEADERS });
}

// ---------------------------------------------------------------------------
// Cron: nightly pruning so the append-only tables cannot grow without bound
// (D1 free-tier daily limits are enforced since 2026-09). One daily run
// covers every table; the loop is capped so a large backlog shrinks over
// days instead of exhausting the invocation's CPU budget.
// ---------------------------------------------------------------------------

const PRUNE_BATCH = 400;
const PRUNE_MAX_ROUNDS = 25;

// D1 has no DELETE ... LIMIT — delete via an id subquery in batches until
// one comes back short (or the round cap is hit).
async function pruneInBatches(env, sql) {
  for (let round = 0; round < PRUNE_MAX_ROUNDS; round++) {
    const res = await env.DB.prepare(sql).run();
    if (!res.meta || res.meta.changes < PRUNE_BATCH) return;
  }
}

// Long-expired comment_rate windows are also swept opportunistically on every
// POST (see checkRateLimit); this is the backstop covering all three tables.
async function pruneTables(env) {
  // Uses idx_ai_logs_created for the subquery; the outer delete hits the PK.
  await pruneInBatches(
    env,
    "DELETE FROM ai_logs WHERE id IN (SELECT id FROM ai_logs WHERE created_at < datetime('now', '-90 days') LIMIT 400)"
  );
  await env.DB.prepare(
    "DELETE FROM ai_usage WHERE month < strftime('%Y-%m', datetime('now', '-13 months'))"
  ).run();
  await env.DB.prepare(
    "DELETE FROM comment_rate WHERE window_start < ?"
  ).bind(Math.floor(Date.now() / 1000) - 86400).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The AI proxy owns its (open) CORS — including preflights — so it is
    // dispatched before the generic OPTIONS short-circuit below.
    if (url.pathname.startsWith("/api/ai/")) {
      return handleAi(request, env, ctx, url);
    }

    const allowedOrigins = [
      "https://nathanpenny.fun",
      "https://blog.nathanpenny.fun",
      "https://nathanpenny520.github.io",
      "http://localhost:8080"
    ];

    // Only echo an origin back when it is allowlisted; omit the CORS header
    // otherwise so responses stay unreadable to foreign sites. curl and other
    // non-browser clients do not care about the header at all.
    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };
    if (origin && allowedOrigins.includes(origin)) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // --- Markdown editor API (editor.js). Lives under /admin/ so the edge
      // Access app covers the subpath and injects the JWT like on the page. ---
      if (url.pathname === "/admin/api/posts" || url.pathname === "/admin/api/post") {
        return handleEditor(request, env, ctx, url);
      }

      // --- Cloudflare Access-protected admin surface (image uploader + editor page) ---
      if (url.pathname === "/admin" && request.method === "GET") {
        if (!(await verifyAccess(request, env))) return accessDenied();
        return new Response(ADMIN_PAGE_HTML, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex"
          }
        });
      }

      if (url.pathname === "/upload") {
        if (!(await verifyAccess(request, env))) return accessDenied();
        if (request.method === "POST") return handleUploadPost(request, env);
        if (request.method === "GET") return handleUploadList(env, url);
        if (request.method === "DELETE") return handleUploadDelete(env, url);
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: JSON_HEADERS });
      }

      if (url.pathname === "/comments") {
        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT id, name, content, created_at FROM comments ORDER BY created_at DESC LIMIT 100"
          ).all();
          return new Response(JSON.stringify(results || []), { headers: corsHeaders });
        }

        if (request.method === "POST") {
          // Cheap guard first: cap attempts per client IP before doing any
          // parsing, so junk traffic never reaches siteverify or D1 writes.
          const ip = request.headers.get("CF-Connecting-IP") || "unknown";
          if (!(await checkRateLimit(env, ip, Date.now()))) {
            return new Response(
              JSON.stringify({ error: "Too many comments posted. Please wait a minute and try again." }),
              { status: 429, headers: corsHeaders }
            );
          }

          const body = await request.json();
          const { name, email, content } = body;

          if (!name || !email || !content) {
            return new Response(
              JSON.stringify({ error: "All fields are required" }),
              { status: 400, headers: corsHeaders }
            );
          }

          if (hasInvalidLength({ name, email, content })) {
            return new Response(
              JSON.stringify({ error: "One or more fields are too long" }),
              { status: 400, headers: corsHeaders }
            );
          }

          if (!(await verifyTurnstile(env, body["cf-turnstile-response"]))) {
            const status = env.TURNSTILE_SECRET ? 403 : 500;
            const message = env.TURNSTILE_SECRET
              ? "Captcha verification failed. Please try again."
              : "Server captcha configuration missing";
            return new Response(
              JSON.stringify({ error: message }),
              { status: status, headers: corsHeaders }
            );
          }

          await env.DB.prepare(
            "INSERT INTO comments (name, email, content) VALUES (?, ?, ?)"
          ).bind(name, email, content).run();

          // Fire-and-forget: never delays or fails the comment response, and
          // rejected comments (rate limit / Turnstile) never reach this line.
          ctx.waitUntil(sendNotifyEmail(env, name, content));

          return new Response(
            JSON.stringify({ success: true, message: "Comment posted!" }),
            { headers: corsHeaders }
          );
        }

        return new Response(
          JSON.stringify({ error: "Method not allowed" }),
          { status: 405, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ error: "Not found" }),
        { status: 404, headers: corsHeaders }
      );
    } catch (err) {
      // Internal details stay server-side (observability captures the log);
      // mirroring editor.js, which never echoes err.message either.
      console.error("Unhandled worker error:", err);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: corsHeaders }
      );
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      await pruneTables(env);
      console.log("cron prune done");
    } catch (error) {
      // Never throw out of scheduled — a failed prune must not turn into a
      // daily cron error alert.
      console.error("cron prune failed:", error);
    }
  }
};
