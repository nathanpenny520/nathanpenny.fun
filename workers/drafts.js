// 写作台 drafts + scheduled publishing. Drafts live in D1 — deliberately not
// in the public repo, and not in the publicly-readable R2 bucket: slug +
// form metadata + markdown body, with an optional publish_at schedule. The
// 15-minute cron publishes due drafts through the exact same GitHub path the
// editor uses (composePost → validatePost → Contents API) and deletes the
// row on success, so a scheduled post is byte-identical to a hand-published
// one and CI regenerates the site as usual.
import { verifyAccess, accessDenied } from "./access.js";
import { composePost, validatePost, ghFetch, ghMessage, commitPost } from "./editor.js";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const GITHUB_BRANCH = "main";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DRAFT_BYTES = 256 * 1024; // same cap as posts
const MAX_RUN_DRAFTS = 5;           // per cron tick

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export async function handleDrafts(request, env, url) {
  try {
    if (!(await verifyAccess(request, env))) return accessDenied();
    const path = url.pathname;

    if (path === "/admin/api/drafts") {
      if (request.method !== "GET") return json(405, { error: "Method not allowed" });
      const { results } = await env.DB.prepare(
        "SELECT slug, meta, publish_at, updated_at FROM drafts ORDER BY updated_at DESC LIMIT 200"
      ).all();
      const drafts = (results || []).map((row) => {
        let title = "";
        try {
          title = String(JSON.parse(row.meta).title || "");
        } catch (error) { /* keep "" */ }
        return { slug: row.slug, title: title.slice(0, 120), publish_at: row.publish_at, updated_at: row.updated_at };
      });
      return json(200, { drafts });
    }

    if (path === "/admin/api/draft") {
      if (request.method === "GET" || request.method === "DELETE") {
        const slug = url.searchParams.get("slug") || "";
        if (!SLUG_RE.test(slug)) return json(400, { error: "Invalid slug (lowercase letters, digits, hyphens only)" });

        if (request.method === "GET") {
          const row = await env.DB.prepare(
            "SELECT slug, meta, body, publish_at, updated_at FROM drafts WHERE slug = ?1"
          ).bind(slug).first();
          if (!row) return json(404, { error: "No such draft: " + slug });
          let meta = {};
          try {
            meta = JSON.parse(row.meta);
          } catch (error) { /* empty form */ }
          return json(200, {
            slug: row.slug, meta, body: row.body,
            publish_at: row.publish_at, updated_at: row.updated_at
          });
        }

        const res = await env.DB.prepare("DELETE FROM drafts WHERE slug = ?1").bind(slug).run();
        return json(200, { success: true, deleted: res.meta ? res.meta.changes : 0 });
      }

      if (request.method === "POST") {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          return json(415, { error: "Content-Type must be application/json" });
        }
        let body;
        try {
          body = await request.json();
        } catch (error) {
          return json(400, { error: "Invalid JSON" });
        }
        // The slug rides in the body on POST (the query-string variant is
        // only used by GET/DELETE above).
        const slug = typeof body.slug === "string" ? body.slug : "";
        if (!SLUG_RE.test(slug)) return json(400, { error: "Invalid slug (lowercase letters, digits, hyphens only)" });
        const meta = body && typeof body.meta === "object" && body.meta ? body.meta : {};
        const text = typeof body.body === "string" ? body.body : "";
        if (!Object.keys(meta).length && !text.trim()) return json(400, { error: "Draft is empty" });
        let publishAt = null;
        if (body.publish_at != null) {
          publishAt = parseInt(body.publish_at, 10);
          if (Number.isNaN(publishAt)) return json(400, { error: "publish_at must be epoch seconds or null" });
        }
        const payload = JSON.stringify({ slug, meta, body: text, publish_at: publishAt });
        if (new TextEncoder().encode(payload).length > MAX_DRAFT_BYTES) {
          return json(413, { error: "Draft exceeds 256KB" });
        }
        await env.DB.prepare(
          "INSERT INTO drafts (slug, meta, body, publish_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
          "ON CONFLICT (slug) DO UPDATE SET meta = excluded.meta, body = excluded.body, " +
          "publish_at = excluded.publish_at, updated_at = excluded.updated_at"
        ).bind(slug, JSON.stringify(meta), text, publishAt, Math.floor(Date.now() / 1000)).run();
        return json(200, { success: true, slug, publish_at: publishAt });
      }

      return json(405, { error: "Method not allowed" });
    }

    return json(404, { error: "Not found" });
  } catch (error) {
    // Never echo err.message — internal details stay server-side.
    console.error("drafts error:", error && error.message);
    return json(500, { error: "Draft request failed" });
  }
}

// Publish every draft whose schedule is due. Called from scheduled() — no
// request, no Access check needed. Returns the number published.
export async function publishDueDrafts(env) {
  if (!env.GITHUB_TOKEN) return 0;
  const now = Math.floor(Date.now() / 1000);
  const due = await env.DB.prepare(
    "SELECT slug, meta, body FROM drafts WHERE publish_at IS NOT NULL AND publish_at <= ?1 ORDER BY publish_at LIMIT ?2"
  ).bind(now, MAX_RUN_DRAFTS).all();

  let published = 0;
  for (const row of due.results || []) {
    const slug = String(row.slug);
    let meta = {};
    try {
      meta = JSON.parse(row.meta);
    } catch (error) { /* composePost tolerates an empty meta */ }
    const content = composePost(meta, row.body);

    const invalid = validatePost(content);
    if (invalid) {
      // Deterministic failure — it would fail on every retry. Drop the
      // schedule, keep the draft, and let the owner fix it in the 写作台.
      console.error("scheduled draft " + slug + " is invalid, schedule cleared: " + invalid);
      await env.DB.prepare("UPDATE drafts SET publish_at = NULL WHERE slug = ?1").bind(slug).run();
      continue;
    }

    // Pick up the blob sha when the post already exists so the commit is an
    // update instead of a 422. A GitHub hiccup aborts the whole run — the
    // draft rows stay untouched and the next tick retries.
    let sha = null;
    const existing = await ghFetch(env, "/posts/" + encodeURIComponent(slug) + ".md?ref=" + GITHUB_BRANCH);
    if (existing.status === 200) {
      const data = await existing.json();
      sha = data && data.sha;
    } else if (existing.status !== 404) {
      console.error("scheduled publish aborted on GitHub read: " + (await ghMessage(existing)));
      return published;
    }

    const result = await commitPost(env, slug, content, {
      sha,
      message: (sha ? "update: " : "publish: ") + slug + " (scheduled draft)"
    });
    if (!result.ok) {
      console.error("scheduled publish failed for " + slug + ": " + result.error);
      continue;
    }
    await env.DB.prepare("DELETE FROM drafts WHERE slug = ?1").bind(slug).run();
    published += 1;
  }
  return published;
}
