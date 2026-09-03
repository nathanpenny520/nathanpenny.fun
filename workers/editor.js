// Markdown editor backend for the 写作台 tab on the /admin page.
// Publishes posts/<slug>.md to GitHub (nathanpenny520/nathanpenny.fun, branch
// main) via the Contents API; the gen-posts workflow then regenerates the
// static pages, so the site itself never changes shape. No database — the
// repository stays the single source of truth.
// Requires the GITHUB_TOKEN secret: a fine-grained PAT with Contents: Read
// and write on that one repository (`npx wrangler secret put GITHUB_TOKEN`).

import { verifyAccess, accessDenied } from "./access.js";

const GITHUB_OWNER = "nathanpenny520";
const GITHUB_REPO = "nathanpenny.fun";
const GITHUB_BRANCH = "main";
const CONTENTS_API = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents";

// Keep in sync with tools/gen_post_pages.py CATEGORIES — an unknown slug
// makes the generator sys.exit and turns the CI run red.
const CATEGORIES = ["anime", "life", "tech", "fun", "fiction", "travel", "ai", "sports", "misc"];

// The generator uses the raw filename stem with no validation at all, so
// this regex is the only thing standing between a typo and a red CI run.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_BODY_CHARS = 400000; // JSON envelope guard, checked before parsing

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function editorJson(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

// btoa() throws on non-latin1 text (all Chinese posts) and huge argument
// lists, so encode UTF-8 bytes in 0x8000-char chunks.
function base64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64DecodeUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// All editor GitHub calls funnel through here so the token can never leak
// into logs or error responses — only status codes and GitHub's message do.
async function ghFetch(env, path, init) {
  return fetch(CONTENTS_API + path, {
    method: (init && init.method) || "GET",
    body: init && init.body,
    headers: {
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nathanpenny-fun-editor",
      "Content-Type": "application/json"
    }
  });
}

// GitHub error bodies never echo the token, but cap the relayed message anyway.
async function ghMessage(res) {
  try {
    const data = await res.json();
    return data && data.message ? String(data.message).slice(0, 200) : "GitHub API " + res.status;
  } catch (error) {
    return "GitHub API " + res.status;
  }
}

// Mirror of the generator's hard rules — every failure here would otherwise
// make tools/gen_post_pages.py sys.exit and leave a red CI run behind.
function validatePost(content) {
  if (typeof content !== "string" || content.length === 0) return "内容为空";
  if (content.charCodeAt(0) === 0xfeff) return "内容以 BOM 开头 — 生成器要求 frontmatter 从字节 0 开始，请删掉";
  if (!content.startsWith("---\n")) return "必须以 frontmatter 开头（第一行是 ---）";
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return "frontmatter 未闭合（缺少结尾的 ---）";
  const fm = content.slice(4, end);

  const title = fm.match(/^title:[ \t]*(.+)$/m);
  if (!title || !title[1].trim()) return "frontmatter 缺少 title";

  const date = fm.match(/^date:[ \t]*(\S+)[ \t]*$/m);
  if (!date) return "frontmatter 缺少 date（YYYY-MM-DD）";
  // Round-trip: 2026-02-30 passes any regex but datetime.date.fromisoformat
  // in CI does not, so validate by parsing back.
  const d = date[1];
  const parsed = new Date(d + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) {
    return "date 不是有效的 YYYY-MM-DD（如 2026-02-30 会让 CI 失败）";
  }

  const cat = fm.match(/^category:[ \t]*(\S+)[ \t]*$/m);
  if (cat && !CATEGORIES.includes(cat[1])) {
    return "未知 category \"" + cat[1] + "\" — 可选：" + CATEGORIES.join(" / ");
  }

  return null;
}

function requireToken(env) {
  if (!env.GITHUB_TOKEN) {
    return editorJson(503, { error: "GITHUB_TOKEN not configured — run: npx wrangler secret put GITHUB_TOKEN" });
  }
  return null;
}

async function listPosts(env) {
  const noToken = requireToken(env);
  if (noToken) return noToken;

  const res = await ghFetch(env, "/posts?ref=" + GITHUB_BRANCH);
  if (res.status === 401 || res.status === 403) {
    return editorJson(503, { error: "GITHUB_TOKEN 被拒绝（过期或权限不足）：" + (await ghMessage(res)) });
  }
  if (!res.ok) return editorJson(502, { error: await ghMessage(res) });

  const items = await res.json();
  const posts = (Array.isArray(items) ? items : [])
    .filter((it) => it.type === "file" && it.name.endsWith(".md"))
    .map((it) => ({ slug: it.name.slice(0, -3), size: it.size, sha: it.sha }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
  return editorJson(200, { posts });
}

async function readPost(env, url) {
  const slug = url.searchParams.get("slug") || "";
  if (!SLUG_RE.test(slug)) return editorJson(400, { error: "无效 slug（只允许小写字母、数字、连字符）" });

  const noToken = requireToken(env);
  if (noToken) return noToken;

  const res = await ghFetch(env, "/posts/" + encodeURIComponent(slug) + ".md?ref=" + GITHUB_BRANCH);
  if (res.status === 404) return editorJson(404, { error: "文章不存在：" + slug });
  if (!res.ok) return editorJson(502, { error: await ghMessage(res) });

  const data = await res.json();
  return editorJson(200, {
    slug: slug,
    sha: data.sha,
    size: data.size,
    content: base64DecodeUtf8(data.content || "")
  });
}

async function publishPost(request, env) {
  // CSRF line: a cross-site form/fetch cannot send application/json without
  // triggering a preflight, and this API never answers preflights.
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return editorJson(415, { error: "Content-Type must be application/json" });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return editorJson(413, { error: "请求体过大" });

  let body;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    return editorJson(400, { error: "JSON 解析失败" });
  }

  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!SLUG_RE.test(slug)) return editorJson(400, { error: "无效 slug（只允许小写字母、数字、连字符）" });

  const contentError = validatePost(body.content);
  if (contentError) return editorJson(400, { error: contentError });

  if (new TextEncoder().encode(body.content).length > MAX_CONTENT_BYTES) {
    return editorJson(413, { error: "文章超过 256KB" });
  }

  const noToken = requireToken(env);
  if (noToken) return noToken;

  const creating = !body.sha;
  const payload = {
    message: (creating ? "publish: " : "update: ") + slug + " (editor)",
    content: base64EncodeUtf8(body.content),
    branch: GITHUB_BRANCH
  };
  if (!creating) payload.sha = String(body.sha);

  const res = await ghFetch(env, "/posts/" + encodeURIComponent(slug) + ".md", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  if (res.status === 409 || res.status === 422) {
    return editorJson(409, { error: "远端已更新（sha 不匹配）— 请重新加载该文章后再发布" });
  }
  if (!res.ok) return editorJson(502, { error: await ghMessage(res) });

  const data = await res.json();
  return editorJson(res.status === 201 ? 201 : 200, {
    success: true,
    created: res.status === 201,
    sha: data.content && data.content.sha,
    commit_url: data.commit && data.commit.html_url
  });
}

async function deletePost(env, url) {
  const slug = url.searchParams.get("slug") || "";
  if (!SLUG_RE.test(slug)) return editorJson(400, { error: "无效 slug（只允许小写字母、数字、连字符）" });
  const sha = url.searchParams.get("sha") || "";
  if (!sha) return editorJson(400, { error: "缺少 sha — 请先在编辑器中打开该文章" });

  const noToken = requireToken(env);
  if (noToken) return noToken;

  const res = await ghFetch(env, "/posts/" + encodeURIComponent(slug) + ".md", {
    method: "DELETE",
    body: JSON.stringify({ message: "delete: " + slug + " (editor)", sha: sha, branch: GITHUB_BRANCH })
  });
  if (res.status === 409 || res.status === 422) {
    return editorJson(409, { error: "远端已更新（sha 不匹配）— 请刷新列表后重试" });
  }
  if (res.status === 404) return editorJson(404, { error: "文章不存在：" + slug });
  if (!res.ok) return editorJson(502, { error: await ghMessage(res) });

  return editorJson(200, { success: true });
}

export async function handleEditor(request, env, ctx, url) {
  try {
    if (!(await verifyAccess(request, env))) return accessDenied();

    if (url.pathname === "/admin/api/posts") {
      if (request.method !== "GET") return editorJson(405, { error: "Method not allowed" });
      return await listPosts(env);
    }

    if (url.pathname === "/admin/api/post") {
      if (request.method === "GET") return await readPost(env, url);
      if (request.method === "POST") return await publishPost(request, env);
      if (request.method === "DELETE") return await deletePost(env, url);
      return editorJson(405, { error: "Method not allowed" });
    }

    return editorJson(404, { error: "Not found" });
  } catch (error) {
    // Never echo err.message — fetch failures can embed response text/URLs.
    console.log("editor error:", error.status || "", error.message);
    return editorJson(500, { error: "Editor request failed" });
  }
}
