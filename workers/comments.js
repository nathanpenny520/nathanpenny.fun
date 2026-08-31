// Cloudflare Worker backend for the comments system.
// Based on the existing visitor form worker, extended with /comments endpoints.

// Turnstile server-side verification for POST /comments.
const TURNSTILE_ACTION = "comment";
// Production frontends only — never include localhost here.
const TURNSTILE_HOSTNAMES = new Set([
  "nathanpenny.fun",
  "blog.nathanpenny.fun",
  "nathanpenny520.github.io"
]);

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

export default {
  async fetch(request, env) {
    const allowedOrigins = [
      "https://nathanpenny.fun",
      "https://blog.nathanpenny.fun",
      "https://nathanpenny520.github.io",
      "http://localhost:8080"
    ];

    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Reject oversized payloads early so the database cannot be flooded.
    const MAX_LENGTHS = { name: 50, email: 200, content: 2000 };
    function hasInvalidLength(fields) {
      return Object.entries(MAX_LENGTHS).some(
        ([field, max]) => fields[field] !== undefined && String(fields[field]).length > max
      );
    }

    try {
      // Comments API (used by contact.html)
      if (url.pathname === "/comments") {
        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT id, name, content, created_at FROM comments ORDER BY created_at DESC"
          ).all();
          return new Response(JSON.stringify(results || []), { headers: corsHeaders });
        }

        if (request.method === "POST") {
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

      // Legacy visitor form API (used by any old pages or tests)
      if (request.method === "POST") {
        const { name, email } = await request.json();

        if (!name || !email) {
          return new Response(
            JSON.stringify({ error: "Name and email are required" }),
            { status: 400, headers: corsHeaders }
          );
        }

        if (hasInvalidLength({ name, email })) {
          return new Response(
            JSON.stringify({ error: "One or more fields are too long" }),
            { status: 400, headers: corsHeaders }
          );
        }

        await env.DB.prepare("INSERT INTO visitors (name, email) VALUES (?, ?)")
                    .bind(name, email)
                    .run();

        return new Response(
          JSON.stringify({ success: true, message: "Submitted!" }),
          { headers: corsHeaders }
        );
      }

      if (request.method === "GET") {
        // Email is deliberately excluded: this endpoint is publicly readable.
        const { results } = await env.DB.prepare(
          "SELECT id, name, created_at FROM visitors ORDER BY created_at DESC"
        ).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: corsHeaders }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  }
};
