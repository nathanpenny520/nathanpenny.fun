// Cloudflare Worker backend for the comments system.
// Based on the existing visitor form worker, extended with /comments endpoints.

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
          const { name, email, content } = await request.json();

          if (!name || !email || !content) {
            return new Response(
              JSON.stringify({ error: "All fields are required" }),
              { status: 400, headers: corsHeaders }
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

        await env.DB.prepare("INSERT INTO visitors (name, email) VALUES (?, ?)")
                    .bind(name, email)
                    .run();

        return new Response(
          JSON.stringify({ success: true, message: "Submitted!" }),
          { headers: corsHeaders }
        );
      }

      if (request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM visitors ORDER BY created_at DESC").all();
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
