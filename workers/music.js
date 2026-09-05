// Music library backend for the /admin Music tab. The R2 `music/` prefix is
// the storage of record for the Creations-page audio (served read-only via
// storage.nathanpenny.fun), and data/music-library.json in the repo is the
// generated catalog the static page fetches. This module replaces the old
// local pipeline (tools/gen_music_library.py + tools/upload_music_r2.sh):
// audio uploads go straight to R2 from the browser, and a sync rebuilds the
// JSON from a full R2 listing + an iTunes cover lookup, committing through
// the same Contents-API path as the editor (editor.js ghFetch).
//
// Rules carried over verbatim from the Python tool — the site JSON must not
// change shape just because the generator moved:
//   - object keys collapse any run of 2+ dots into `…` (r2Key; the public
//     GET path would hit the Cloudflare WAF `...` rule — local filenames are
//     untouched, only the stored key is folded)
//   - entries are {id, type:"song", title, artist, album, src, cover}, sorted
//     by artist/album/title (lowercase), JSON is 2-space-indented UTF-8
//   - src = https://storage.nathanpenny.fun/music/<URL-quoted rel path>
//   - existing JSON entries are reused verbatim (id + cover), so a re-sync
//     never churns ids or re-downloads covers; only brand-new songs get a
//     fresh id (slugify port) and a cover lookup
//
// Endpoints (all Access-verified, like editor.js):
//   GET    /admin/api/music/tree    R2 listing + published flag from the repo JSON
//   POST   /admin/api/music/upload  multipart (files[] + artist[] + album[]) -> R2
//   DELETE /admin/api/music?file=…  remove one object under music/
//   POST   /admin/api/music/plan    dry-run of the sync (no writes anywhere)
//   POST   /admin/api/music/cover   look up + commit the cover for ONE new song
//   POST   /admin/api/music/commit  rebuild data/music-library.json and commit it

import { verifyAccess, accessDenied } from "./access.js";
import { ghFetch, ghMessage, base64EncodeUtf8 } from "./editor.js";

const GITHUB_BRANCH = "main";
const MUSIC_PREFIX = "music/";
const MUSIC_BASE = "https://storage.nathanpenny.fun/music/";
const SITE_ORIGIN = "https://nathanpenny.fun/";
const COVERS_REPO_DIR = "images/music-covers/";
const META_KEY = "music/.covers.json"; // itunes results, hidden from listings

// Match the old pipeline's accepted set (gen_music_library.py AUDIO_EXTS).
const AUDIO_TYPES = { mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4" };
// Audio files are much bigger than images; 64MB keeps formData() buffering
// comfortably inside the Worker memory limit (FLAC tracks rarely exceed it).
const MAX_MUSIC_BYTES = 64 * 1024 * 1024;

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function musicJson(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

// --- ports of the Python generator's string rules ---------------------------

// r2_key(): fold dot-runs so no stored key can ever contain ".." — the
// storage domain serves keys as URL paths and the WAF 403s `...` (and
// anything with a ".." looks like traversal anyway). MUST stay applied on
// every write and every generated src.
function r2Key(rel) {
  return rel.replace(/\.{2,}/g, "…");
}

// slugify(): readable slug base for ids/covers. The Python original kept
// unicode word chars (\w), so Chinese titles survive here too.
function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

// title_of(): filename convention is <Title>-<Album>-<Artist>; the directory
// names are the truth, so strip them off the stem's tail. Dot runs collapse
// first and the suffix match tolerates a `…` prefix, because filenames and
// folder names disagree about leading dots (e.g. the `...Baby One More Time`
// file inside `Baby One More Time/`).
function titleOf(stem, artistDir, albumDir) {
  const collapse = (s) => s.replace(/\.{2,}/g, "…");
  let title = collapse(stem);
  for (const part of [artistDir, albumDir]) {
    title = title.replace(new RegExp("-(…?" + part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")$"), "");
  }
  title = title.replace(/^[-\s]+/, "").replace(/[-\s]+$/, "").trim();
  return title || collapse(stem);
}

// urllib.parse.quote(rel, safe="/") parity: encodeURIComponent leaves !'()*
// bare; Python percent-encodes them. Split on "/" so separators survive.
function encodeRelPath(rel) {
  return rel
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))
    .join("/");
}

function extOf(filename) {
  const m = String(filename).match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : "";
}

// --- GitHub: the committed catalog -------------------------------------------

// Reads data/music-library.json from the repo. A missing file (fresh setup)
// is an empty catalog; any other failure throws so callers can degrade.
async function readLibraryJson(env) {
  const res = await ghFetch(env, "/data/music-library.json?ref=" + GITHUB_BRANCH);
  if (res.status === 404) return { sha: null, raw: null, songs: [] };
  if (!res.ok) throw new Error(await ghMessage(res));
  const data = await res.json();
  let songs = [];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob((data.content || "").replace(/\s/g, "")), (c) => c.charCodeAt(0))));
    if (Array.isArray(parsed)) {
      songs = parsed.filter((e) => e && typeof e === "object" && typeof e.src === "string");
    }
  } catch (error) {
    songs = [];
  }
  return { sha: data.sha, raw: data.content || null, songs };
}

// --- R2: the audio of record --------------------------------------------------

// Full flat listing of music/, cursor included. The .covers.json metadata
// file and anything dotted are skipped (folder-marker convention).
async function listAllMusic(env) {
  const out = [];
  let cursor;
  for (let page = 0; page < 30; page++) {
    const options = { prefix: MUSIC_PREFIX, limit: 1000 };
    if (cursor) options.cursor = cursor;
    const listing = await env.R2.list(options);
    for (const o of listing.objects || []) {
      const name = o.key.slice(o.key.lastIndexOf("/") + 1);
      if (name.startsWith(".")) continue;
      out.push({ key: o.key, name, size: o.size, uploaded: o.uploaded ? o.uploaded.toISOString() : null });
    }
    if (!listing.truncated) break;
    cursor = listing.cursor;
  }
  // Lexicographic == artist/album/file order, same sort the generator used.
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

async function readCoverMeta(env) {
  try {
    const obj = await env.R2.get(META_KEY);
    if (!obj) return {};
    return JSON.parse(await obj.text());
  } catch (error) {
    return {};
  }
}

async function writeCoverMeta(env, meta) {
  await env.R2.put(META_KEY, JSON.stringify(meta, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });
}

// One music object, fully validated: music/ prefix, exactly Artist/Album/
// file, no dotted or empty segments, known extension. Returns null when the
// key is not a song this module manages.
function parseMusicKey(key) {
  key = String(key == null ? "" : key);
  if (!key.startsWith(MUSIC_PREFIX) || key.endsWith("/") || key.includes("\\") || key.includes("..")) return null;
  const parts = key.slice(MUSIC_PREFIX.length).split("/");
  if (parts.length !== 3) return null;
  const [artist, album, filename] = parts;
  if (!artist.trim() || !album.trim() || !filename) return null;
  if ([artist, album, filename].some((p) => p.startsWith("."))) return null;
  if (artist.length > 80 || album.length > 80 || filename.length > 150) return null;
  if (!AUDIO_TYPES[extOf(filename)]) return null;
  return { artist, album, filename, ext: extOf(filename) };
}

// --- entry building (shared by plan and commit) ------------------------------

// Build the complete next catalog from R2 + the committed JSON + cover meta.
// Existing srcs are reused verbatim; new songs derive title/id/cover. Never
// writes anything — plan returns it directly, commit stringifies it.
async function buildCatalog(env) {
  const [listing, library, meta] = await Promise.all([listAllMusic(env), readLibraryJson(env), readCoverMeta(env)]);
  const priorBySrc = new Map(library.songs.map((e) => [e.src, e]));
  const usedIds = new Set(library.songs.map((e) => e.id).filter(Boolean));

  const songs = [];
  const added = [];
  const presentSrcs = new Set();

  for (const item of listing) {
    const parsed = parseMusicKey(item.key);
    if (!parsed) continue;
    const rel = item.key.slice(MUSIC_PREFIX.length);
    const src = MUSIC_BASE + encodeRelPath(rel);
    presentSrcs.add(src);

    const prior = priorBySrc.get(src);
    if (prior) {
      songs.push({
        id: prior.id,
        type: "song",
        title: prior.title,
        artist: prior.artist,
        album: prior.album,
        src: prior.src,
        cover: prior.cover == null ? null : prior.cover
      });
      continue;
    }

    const title = titleOf(parsed.filename.replace(/\.[^.]+$/, ""), parsed.artist, parsed.album);
    const base = slugify(parsed.artist + "-" + parsed.album + "-" + title);
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = base + "-" + n;
    usedIds.add(id);
    const metaEntry = meta[rel];
    const cover = metaEntry && metaEntry.name ? "../" + COVERS_REPO_DIR + metaEntry.name : null;
    const entry = { id, type: "song", title, artist: parsed.artist.trim(), album: parsed.album.trim(), src, cover };
    songs.push(entry);
    added.push({ rel, id, cover });
  }

  // Songs deleted from R2 simply never get pushed above — their old JSON
  // entries drop out naturally; count them for the report.
  const removedCount = library.songs.filter((e) => !presentSrcs.has(e.src)).length;

  songs.sort((a, b) => {
    const a1 = String(a.artist).toLowerCase();
    const b1 = String(b.artist).toLowerCase();
    if (a1 !== b1) return a1 < b1 ? -1 : 1;
    const a2 = String(a.album).toLowerCase();
    const b2 = String(b.album).toLowerCase();
    if (a2 !== b2) return a2 < b2 ? -1 : 1;
    const a3 = String(a.title).toLowerCase();
    const b3 = String(b.title).toLowerCase();
    return a3 < b3 ? -1 : a3 > b3 ? 1 : 0;
  });

  return { songs, added, removedCount, meta, librarySha: library.sha, libraryRaw: library.raw, total: songs.length };
}

function catalogJsonText(songs) {
  return JSON.stringify(songs, null, 2) + "\n";
}

// --- covers -------------------------------------------------------------------

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Diacritic- and punctuation-insensitive match key; CJK chars are kept so
// Chinese artist/album names compare meaningfully.
function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "");
}

// Conservative iTunes album match: artist AND album must each overlap after
// normalization (substring either way, shorter side at least 2 chars) — a
// wrong cover is worse than no cover, so anything ambiguous is a miss.
function matchCover(result, nArtist, nAlbum) {
  const nResArtist = normName(result.artistName);
  const nResAlbum = normName(result.collectionName);
  const overlaps = (a, b) => {
    if (!a || !b) return false;
    const shorter = a.length < b.length ? a : b;
    if (shorter.length < 2) return false;
    return a === b || a.includes(b) || b.includes(a);
  };
  if (!overlaps(nResArtist, nArtist) || !overlaps(nResAlbum, nAlbum)) return null;
  const art = result.artworkUrl100;
  return typeof art === "string" ? art.replace("100x100bb.jpg", "600x600bb.jpg") : null;
}

async function lookupCoverArt(artist, album) {
  const url = "https://itunes.apple.com/search?term=" + encodeURIComponent(artist + " " + album) + "&entity=album&limit=8";
  const res = await fetch(url, {
    headers: { "User-Agent": "nathanpenny-fun-admin", "Accept": "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return null;
  const data = await res.json();
  const nArtist = normName(artist);
  const nAlbum = normName(album);
  for (const result of (data && data.results) || []) {
    const art = matchCover(result, nArtist, nAlbum);
    if (art) return art;
  }
  return null;
}

async function base64EncodeBytes(bytes) {
  let bin = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// PUT a cover jpg; if it already exists (a previous run died between the
// file commit and the meta write), pick up its sha and overwrite.
async function commitCoverFile(env, name, bytes) {
  const content = await base64EncodeBytes(bytes);
  const payload = {
    message: "music: cover " + name + " (admin)",
    content,
    branch: GITHUB_BRANCH
  };
  let res = await ghFetch(env, "/" + COVERS_REPO_DIR + encodeURIComponent(name), {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  if (res.status === 409 || res.status === 422) {
    const existing = await ghFetch(env, "/" + COVERS_REPO_DIR + encodeURIComponent(name) + "?ref=" + GITHUB_BRANCH);
    if (existing.ok) {
      const data = await existing.json();
      res = await ghFetch(env, "/" + COVERS_REPO_DIR + encodeURIComponent(name), {
        method: "PUT",
        body: JSON.stringify({ ...payload, sha: data.sha })
      });
    }
  }
  if (!res.ok) throw new Error(await ghMessage(res));
}

// Cover for ONE new song: iTunes lookup -> commit the jpg to the repo ->
// remember it in the R2 meta file. Runs per-song from the tab so a full
// library sync never fans out enough subrequests to hit a Worker limit, and
// an interrupted run resumes where it stopped (meta is checked first).
async function handleCover(request, env) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return musicJson(415, { error: "Content-Type must be application/json" });
  }
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return musicJson(400, { error: "Invalid JSON" });
  }
  const rel = typeof body.rel === "string" ? body.rel : "";
  // rel arrives in stored-key form (dot runs already folded to `…`), which
  // is also how the meta file keys entries — dot-folded files get covers too.
  const parsed = parseMusicKey(MUSIC_PREFIX + rel);
  if (!parsed) {
    return musicJson(400, { error: "Invalid music path" });
  }

  const meta = await readCoverMeta(env);
  if (!(meta[rel] && meta[rel].name)) {
    const title = titleOf(parsed.filename.replace(/\.[^.]+$/, ""), parsed.artist, parsed.album);
    const art = await lookupCoverArt(parsed.artist.trim(), parsed.album.trim());
    if (!art) return musicJson(200, { miss: true, rel });

    const slug = slugify(parsed.artist + "-" + parsed.album + "-" + title);
    const hash = (await sha256Hex(rel)).slice(0, 8);
    const name = slug + "-" + hash + ".jpg";
    const artRes = await fetch(art, { signal: AbortSignal.timeout(20000) });
    const type = artRes.headers.get("Content-Type") || "";
    if (!artRes.ok || !type.startsWith("image/")) return musicJson(200, { miss: true, rel });
    const bytes = await artRes.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
      return musicJson(200, { miss: true, rel });
    }
    await commitCoverFile(env, name, bytes);
    meta[rel] = { name, art, by: "itunes", at: new Date().toISOString() };
    await writeCoverMeta(env, meta);
  }
  return musicJson(200, {
    cover: "../" + COVERS_REPO_DIR + meta[rel].name,
    coverUrl: SITE_ORIGIN + COVERS_REPO_DIR + meta[rel].name,
    rel
  });
}

// --- endpoint bodies -----------------------------------------------------------

// GET tree: the R2 listing annotated with the committed JSON's id/cover so
// the tab can badge songs that are not published yet.
async function handleTree(env) {
  const listing = await listAllMusic(env);
  let library = null;
  try {
    library = await readLibraryJson(env);
  } catch (error) {
    library = null; // GitHub trouble: still show the R2 contents, unbadged
  }
  const priorBySrc = new Map(library ? library.songs.map((e) => [e.src, e]) : []);
  const songs = [];
  for (const item of listing) {
    const parsed = parseMusicKey(item.key);
    if (!parsed) continue;
    const rel = item.key.slice(MUSIC_PREFIX.length);
    const prior = priorBySrc.get(MUSIC_BASE + encodeRelPath(rel));
    songs.push({
      key: item.key,
      rel,
      artist: prior ? prior.artist : parsed.artist,
      album: prior ? prior.album : parsed.album,
      title: prior ? prior.title : titleOf(parsed.filename.replace(/\.[^.]+$/, ""), parsed.artist, parsed.album),
      cover: prior && prior.cover ? SITE_ORIGIN + prior.cover.replace(/^\.\.\//, "") : null,
      size: item.size,
      uploaded: item.uploaded,
      published: library ? !!prior : null
    });
  }
  return musicJson(200, { songs, total: songs.length, githubOk: !!library });
}

// POST upload: multipart with three parallel fields per file — files[],
// artist[], album[] — one file per request from the tab (progress + memory).
async function handleUpload(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (error) {
    return musicJson(400, { error: "Expected multipart/form-data" });
  }
  const files = [...form.getAll("files")].filter((f) => typeof f !== "string");
  const artists = form.getAll("artist").map(String);
  const albums = form.getAll("album").map(String);
  if (!files.length) return musicJson(400, { error: "No files under the 'files' field" });
  if (files.length !== artists.length || files.length !== albums.length) {
    return musicJson(400, { error: "artist/album fields must match the file count" });
  }
  if (files.length > 10) return musicJson(400, { error: "Too many files (10 per request maximum)" });

  const uploaded = [];
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      if (file.size > MAX_MUSIC_BYTES) throw new Error(file.name + ": larger than 64MB");
      const ext = extOf(file.name);
      const contentType = AUDIO_TYPES[ext];
      if (!contentType) throw new Error(file.name + ": unsupported type (mp3, flac, m4a only)");
      const artist = artists[i].trim();
      const album = albums[i].trim();
      if (!artist || !album) throw new Error(file.name + ": missing artist/album");
      const key = r2Key(MUSIC_PREFIX + artist + "/" + album + "/" + file.name);
      if (!parseMusicKey(key)) throw new Error(file.name + ": invalid artist/album/file name");

      // Light magic-byte sniff, same idea as the image uploader.
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const ascii = (from, to) => String.fromCharCode.apply(null, head.subarray(from, to));
      const looksRight =
        (ext === "mp3" && (ascii(0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))) ||
        (ext === "flac" && ascii(0, 4) === "fLaC") ||
        (ext === "m4a" && ascii(4, 8) === "ftyp");
      if (!looksRight) throw new Error(file.name + ": content does not look like " + ext);

      await env.R2.put(key, file, {
        httpMetadata: {
          contentType,
          cacheControl: "public, max-age=31536000, immutable"
        }
      });
      uploaded.push({ key, url: "https://storage.nathanpenny.fun/" + encodeRelPath(key), size: file.size });
    } catch (error) {
      failed.push(String(error.message || error));
    }
  }
  return musicJson(uploaded.length ? 200 : 400, { uploaded, failed });
}

// DELETE ?file=music/<Artist>/<Album>/<name> — the R2 copy only; the public
// JSON drops the entry on the next sync.
async function handleDelete(env, url) {
  const key = url.searchParams.get("file") || "";
  if (!parseMusicKey(key) || key === META_KEY) {
    return musicJson(400, { error: "Invalid music path" });
  }
  await env.R2.delete(key);
  return musicJson(200, { success: true });
}

// POST plan: the full what-would-change answer with zero writes.
async function handlePlan(env) {
  if (!env.GITHUB_TOKEN) {
    return musicJson(503, { error: "GITHUB_TOKEN not configured — run: npx wrangler secret put GITHUB_TOKEN" });
  }
  const catalog = await buildCatalog(env);
  return musicJson(200, {
    total: catalog.total,
    added: catalog.added,
    removedCount: catalog.removedCount,
    unchanged: catalog.total - catalog.added.length
  });
}

// POST commit: rebuild and push data/music-library.json. No body needed —
// the catalog is recomputed from R2 + meta so an interrupted cover loop
// simply resumes.
async function handleCommit(env) {
  if (!env.GITHUB_TOKEN) {
    return musicJson(503, { error: "GITHUB_TOKEN not configured — run: npx wrangler secret put GITHUB_TOKEN" });
  }
  const catalog = await buildCatalog(env);
  const text = catalogJsonText(catalog.songs);
  if (text === catalog.libraryRaw) {
    return musicJson(200, { committed: false, total: catalog.total, added: 0, removed: catalog.removedCount });
  }
  const payload = {
    message: "music: sync library via admin (" + catalog.total + " songs)",
    content: base64EncodeUtf8(text),
    branch: GITHUB_BRANCH
  };
  if (catalog.librarySha) payload.sha = catalog.librarySha;
  const res = await ghFetch(env, "/data/music-library.json", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  if (res.status === 409 || res.status === 422) {
    return musicJson(409, { error: "Changed on GitHub since the plan — press Sync again" });
  }
  if (!res.ok) return musicJson(502, { error: await ghMessage(res) });
  const data = await res.json();
  return musicJson(200, {
    committed: true,
    total: catalog.total,
    added: catalog.added.length,
    removed: catalog.removedCount,
    sha: data.content && data.content.sha,
    commit_url: data.commit && data.commit.html_url
  });
}

export async function handleMusic(request, env, url) {
  try {
    if (!(await verifyAccess(request, env))) return accessDenied();

    if (url.pathname === "/admin/api/music/tree") {
      if (request.method !== "GET") return musicJson(405, { error: "Method not allowed" });
      return await handleTree(env);
    }
    if (url.pathname === "/admin/api/music/upload") {
      if (request.method !== "POST") return musicJson(405, { error: "Method not allowed" });
      return await handleUpload(request, env);
    }
    if (url.pathname === "/admin/api/music") {
      if (request.method === "DELETE") return await handleDelete(env, url);
      return musicJson(405, { error: "Method not allowed" });
    }
    if (url.pathname === "/admin/api/music/plan") {
      if (request.method !== "POST") return musicJson(405, { error: "Method not allowed" });
      return await handlePlan(env);
    }
    if (url.pathname === "/admin/api/music/cover") {
      if (request.method !== "POST") return musicJson(405, { error: "Method not allowed" });
      return await handleCover(request, env);
    }
    if (url.pathname === "/admin/api/music/commit") {
      if (request.method !== "POST") return musicJson(405, { error: "Method not allowed" });
      return await handleCommit(env);
    }
    return musicJson(404, { error: "Not found" });
  } catch (error) {
    // Never echo err.message — R2/GitHub failures can embed internal detail.
    console.log("music error:", error.status || "", error.message);
    return musicJson(500, { error: "Music request failed" });
  }
}
