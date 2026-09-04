// Comment moderation backend for the /admin "Comments" tab: list every
// comment (including the email + ip_hash the public endpoint withholds),
// delete spam, and manage the banned_ips blocklist that POST /comments
// checks before anything else. ip_hash is a salted one-way hash of the
// sender's IP — the address itself is never stored anywhere, which keeps the
// privacy policy's "no IP in our database" promise true while still letting
// the owner blocklist an abusive sender.
import { verifyAccess, accessDenied } from "./access.js";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const HASH_RE = /^[a-f0-9]{8,64}$/i;
const PAGE_SIZE = 50;

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

// CSRF line, mirroring editor.js: a cross-site form/fetch cannot send
// application/json without triggering a preflight this API never answers.
async function readJsonBody(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await request.json();
  } catch (error) {
    return null;
  }
}

export async function handleModeration(request, env, url) {
  try {
    if (!(await verifyAccess(request, env))) return accessDenied();
    const path = url.pathname;

    // The moderation list: everything GET /comments hides (email, ip_hash).
    if (path === "/admin/api/comments") {
      if (request.method !== "GET") return json(405, { error: "Method not allowed" });
      const offset = Math.max(0, parseInt(url.searchParams.get("offset"), 10) || 0);
      const [page, total] = await env.DB.batch([
        env.DB.prepare(
          "SELECT id, parent_id, name, email, content, ip_hash, created_at FROM comments ORDER BY id DESC LIMIT ?1 OFFSET ?2"
        ).bind(PAGE_SIZE, offset),
        env.DB.prepare("SELECT COUNT(*) AS n FROM comments")
      ]);
      return json(200, {
        comments: page.results,
        total: total.results[0] ? total.results[0].n : 0,
        offset,
        pageSize: PAGE_SIZE
      });
    }

    // Delete one comment (?id=) or every comment of one sender (?ip_hash=).
    if (path === "/admin/api/comment") {
      if (request.method !== "DELETE") return json(405, { error: "Method not allowed" });
      const id = parseInt(url.searchParams.get("id"), 10);
      const hash = (url.searchParams.get("ip_hash") || "").toLowerCase();
      if (id) {
        // Deleting a top-level comment takes its replies with it, so the
        // public thread (and the moderation list) never shows orphans.
        const res = await env.DB.prepare(
          "DELETE FROM comments WHERE id = ?1 OR parent_id = ?1"
        ).bind(id).run();
        return json(200, { success: true, deleted: res.meta ? res.meta.changes : 1 });
      }
      if (HASH_RE.test(hash)) {
        const res = await env.DB.prepare("DELETE FROM comments WHERE ip_hash = ?1").bind(hash).run();
        return json(200, { success: true, deleted: res.meta ? res.meta.changes : 0 });
      }
      return json(400, { error: "Provide id or ip_hash" });
    }

    if (path === "/admin/api/bans") {
      if (request.method !== "GET") return json(405, { error: "Method not allowed" });
      const { results } = await env.DB.prepare(
        "SELECT ip_hash, note, created_at FROM banned_ips ORDER BY created_at DESC LIMIT 200"
      ).all();
      return json(200, { bans: results || [] });
    }

    if (path === "/admin/api/ban") {
      if (request.method === "POST") {
        const body = await readJsonBody(request);
        const hash = String(body && body.ip_hash ? body.ip_hash : "").toLowerCase();
        if (!HASH_RE.test(hash)) return json(400, { error: "ip_hash must be 8-64 hex chars" });
        const note = String(body.note || "").slice(0, 200);
        await env.DB.prepare(
          "INSERT INTO banned_ips (ip_hash, note) VALUES (?1, ?2) " +
          "ON CONFLICT (ip_hash) DO UPDATE SET note = excluded.note"
        ).bind(hash, note).run();
        return json(200, { success: true });
      }
      if (request.method === "DELETE") {
        const hash = (url.searchParams.get("ip_hash") || "").toLowerCase();
        if (!HASH_RE.test(hash)) return json(400, { error: "Invalid ip_hash" });
        await env.DB.prepare("DELETE FROM banned_ips WHERE ip_hash = ?1").bind(hash).run();
        return json(200, { success: true });
      }
      return json(405, { error: "Method not allowed" });
    }

    return json(404, { error: "Not found" });
  } catch (error) {
    // Never echo err.message — internal details stay server-side.
    console.error("moderation error:", error && error.message);
    return json(500, { error: "Moderation request failed" });
  }
}
