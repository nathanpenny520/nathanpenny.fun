// Cloudflare Worker backend for the comment system.
// Endpoints:
//   GET  /comments  list comments (email deliberately excluded)
//   POST /comments  create a comment (per-IP rate limit + Turnstile)

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

export default {
  async fetch(request, env) {
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

    const url = new URL(request.url);

    try {
      if (url.pathname === "/comments") {
        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT id, name, content, created_at FROM comments ORDER BY created_at DESC"
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
