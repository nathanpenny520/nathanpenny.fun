// Cloudflare Worker backend: comments, private image uploader, AI proxy.
// Public:
//   GET  /comments  list comments (email deliberately excluded)
//   POST /comments  create a comment (per-IP rate limit + Turnstile)
//   POST /api/ai/v1/chat/completions  OpenAI-compatible proxy (bearer key)
//   GET  /api/ai/v1/models            model catalog (bearer key)
// Cloudflare Access-protected (see verifyAccess below):
//   GET    /admin          self-hosted image upload page (admin_page.js)
//   POST   /upload         multipart images -> R2 img/ prefix
//   GET    /upload?list=1  recent uploads
//   DELETE /upload?key=…   remove one object (img/ prefix only)

import { ADMIN_PAGE_HTML } from "./admin_page.js";
import { handleAi } from "./ai_proxy.js";

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

// --- Cloudflare Access JWT verification (defense in depth) -------------------
// The Access application at the edge already stops unauthenticated browsers;
// this check additionally rejects any request that never went through it
// (e.g. via the worker.dev domain). Fail-closed: missing config -> 503.

let accessJwksCache = null; // { jwks, fetchedAt }
const ACCESS_JWKS_TTL_MS = 24 * 60 * 60 * 1000;

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getAccessJwks(teamDomain) {
  if (accessJwksCache && Date.now() - accessJwksCache.fetchedAt < ACCESS_JWKS_TTL_MS) {
    return accessJwksCache.jwks;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("JWKS fetch failed");
  const jwks = await res.json();
  accessJwksCache = { jwks, fetchedAt: Date.now() };
  return jwks;
}

// True only with a fresh Access JWT correctly signed for this application.
// ADMIN_BYPASS exists solely for `wrangler dev` via the gitignored
// workers/.dev.vars and must NEVER be set on a deployment.
async function verifyAccess(request, env) {
  if (env.ADMIN_BYPASS === "1") return true;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    console.log("access verify: fail (missing config)");
    return false;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    console.log("access verify: fail (no JWT header on request)");
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    console.log("access verify: fail (malformed JWT)");
    return false;
  }

  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const jwks = await getAccessJwks(env.ACCESS_TEAM_DOMAIN);
    const jwk = (jwks.keys || []).find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) {
      console.log("access verify: fail (kid not in JWKS)");
      return false;
    }

    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!ok) {
      console.log("access verify: fail (bad signature)");
      return false;
    }

    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (!claims.exp || Date.now() / 1000 >= claims.exp) {
      console.log("access verify: fail (expired)");
      return false;
    }
    // Comma-separated so two Access apps (one per path) can share this var.
    const audOk = String(env.ACCESS_AUD).split(",").includes(claims.aud);
    if (!audOk) {
      // Never log token contents — just the decision inputs' shapes.
      console.log(`access verify: fail (aud mismatch, claim aud type ${typeof claims.aud})`);
    }
    return audOk;
  } catch (error) {
    console.log(`access verify: fail (exception: ${error.message})`);
    return false;
  }
}

function accessDenied() {
  return new Response(
    JSON.stringify({ error: "Cloudflare Access verification failed. Sign in via https://workers.nathanpenny.fun/admin." }),
    { status: 401, headers: JSON_HEADERS }
  );
}

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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      // --- Cloudflare Access-protected admin surface (image uploader) ---
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
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  }
};
