# Worker Backend: comments + admin (uploader/写作台) + AI proxy

Cloudflare Worker behind `https://workers.nathanpenny.fun` (custom domain;
the `*.workers.dev` URL also exists but admin routes reject it — see Access
below). Feature groups: comments, the Access-protected `/admin` page (image
uploader + markdown editor tabs), and the AI proxy.

## Endpoints

| Method | Path                           | Protection              | Purpose                                        |
|--------|--------------------------------|-------------------------|------------------------------------------------|
| GET    | `/comments`                    | public                  | List comments (`email` deliberately excluded)  |
| POST   | `/comments`                    | public                  | Create a comment (rate limit + Turnstile)      |
| GET    | `/admin`                       | Cloudflare Access       | Admin page: 图床 + 写作台 tabs (admin_page.js + editor_page.js) |
| POST   | `/upload`                      | Cloudflare Access       | Multipart images → R2 `img/` prefix            |
| GET    | `/upload?list=1[&cursor=…]`    | Cloudflare Access       | Recent uploads (newest first)                  |
| DELETE | `/upload?key=img/…`            | Cloudflare Access       | Delete one object (`img/` prefix only)         |
| GET    | `/admin/api/posts`             | Cloudflare Access       | List `posts/*.md` from GitHub (editor.js)      |
| GET    | `/admin/api/post?slug=…`       | Cloudflare Access       | Read one post (decoded UTF-8 + blob sha)       |
| POST   | `/admin/api/post`              | Cloudflare Access       | Publish (create/update) via GitHub Contents API |
| DELETE | `/admin/api/post?slug=…&sha=…` | Cloudflare Access       | Delete a post (CI prunes its generated page)   |
| POST   | `/api/ai/v1/chat/completions`  | Bearer API key          | OpenAI-compatible proxy (see AI proxy below)   |
| GET    | `/api/ai/v1/models`            | Bearer API key          | Model catalog filtered by configured secrets   |
| *      | anything else                  | —                       | 404                                            |

## POST /comments guards (unchanged)

1. **Per-IP rate limit** — 5 attempts per 60s window, counted in the
   `comment_rate` D1 table (`checkRateLimit()`). Exceeding it returns 429.
   (A Workers rate-limit binding was tried first but is silently a no-op on
   this account, so the cap lives in D1.)
2. **Cloudflare Turnstile** — token verified server-side; failure → 403.
   See the Turnstile section below for keys/hostnames.

## Image uploader (图床)

- Storage: the shared R2 bucket `nathanpenny-fun` (bound as `env.R2`),
  prefix `img/YYYY/MM/<slug>-<6hex>.<ext>`. Keys are ASCII-slugged + random,
  so content never changes per key → objects carry
  `Cache-Control: public, max-age=31536000, immutable` via R2 httpMetadata.
- Reading is served by the bucket's public custom domain
  `storage.nathanpenny.fun` — no Worker involvement on reads.
- Slugification removes all dots, which structurally avoids the WAF rule
  that 403s URL paths containing `...` (same lesson as
  `tools/upload_music_r2.sh`).
- Upload validation: extension allowlist (png/jpg/jpeg/webp/gif/avif/svg),
  25MB cap per file, 10 files per request max, light magic-byte sniffing.
- The upload page is a fully self-contained HTML exported by `admin_page.js`
  (drag & drop + clipboard paste + copy-URL/copy-markdown + delete). The
  写作台 editor tab (editor_page.js) reuses the same `/upload` endpoint to
  insert image markdown at the cursor.

## Markdown editor (写作台)

Publishing flow: write in the 写作台 tab → 发布 → the Worker commits
`posts/<slug>.md` to `main` via the GitHub Contents API → the `gen-posts`
workflow regenerates the static pages. The repository stays the single source
of truth; the site itself never changes shape and no database is involved.

- `POST /admin/api/post` validates the frontmatter with the same rules as
  `tools/gen_post_pages.py` (title/date required with a round-trip date check,
  category in the fixed list, no BOM, 256KB cap) — any miss would make the
  generator `sys.exit` and the CI run red. Slugs are `^[a-z0-9][a-z0-9-]{0,63}$`
  (the generator does no filename validation at all).
- Updates carry the blob `sha` from the last read; a 409 means the file
  changed remotely — reload the post. A successful publish returns the new
  sha so back-to-back edits never conflict.
- Deleting a post commits the deletion; CI then prunes the stale
  `blog/<slug>/` directory (the generator removes dirs without a matching
  post).
- Setup: create a GitHub fine-grained PAT scoped to `nathanpenny520/nathanpenny.fun`
  only, with **Contents: Read and write**, then
  `npx wrangler secret put GITHUB_TOKEN`. The token never reaches the page or
  logs — GitHub error messages (capped at 200 chars) are the only upstream
  text relayed to the client.
- Editor APIs live under `/admin/api/*` so the edge Access app (path-prefix)
  covers them and injects the JWT; the Worker re-verifies like everywhere.

### Cloudflare Access

The dashboard-managed Access application (Zero Trust, team
`square-surf-c2a6`) covers `workers.nathanpenny.fun/admin` and
`workers.nathanpenny.fun/upload` with an email-OTP allow policy. It is NOT
in this repo; changes happen in the Zero Trust dashboard.

Defense in depth: the Worker also verifies the `Cf-Access-Jwt-Assertion`
JWT (RS256 against the team JWKS, `exp` + `aud` checks, JWKS cached 24h) —
this closes the `*.workers.dev` bypass, which Access does not cover.
Fail-closed: if `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` vars are missing, admin
routes return 401/503, never open up.

Local development: copy `workers/.dev.vars.example` to `workers/.dev.vars`
(gitignored) and set `ADMIN_BYPASS=1` so `wrangler dev` can serve the page
without a real Access JWT. **Never deploy with that var present.**

## AI proxy (私有 AI 中转)

OpenAI-compatible endpoint — point any OpenAI SDK at
`base_url = https://workers.nathanpenny.fun/api/ai/v1` and use a generated
key. Model prefix decides the upstream (body passes through untouched):

| Model prefix                  | Upstream                                              |
|-------------------------------|-------------------------------------------------------|
| `gpt-*`, `chatgpt-*`, `o1/o3/o4*` | `api.openai.com/v1/chat/completions`              |
| `claude-*`                    | `api.anthropic.com/v1/chat/completions` (official OpenAI-compat layer) |
| `gemini-*`                    | `generativelanguage.googleapis.com/v1beta/openai/…`   |
| `grok-*`                      | `api.x.ai/v1/chat/completions`                        |
| `deepseek-*`                  | `api.deepseek.com/chat/completions`                   |
| `cf-{author}/{model}`         | Workers AI (OpenAI-compat REST route; sent upstream as `@cf/{author}/{model}`) |

Every upstream uses `Authorization: Bearer` (each compatibility layer is
built for the OpenAI SDK, which only sends Bearer). A provider whose secret
is unset returns 503; unknown prefixes return 400 listing them.

### AI Gateway fronting (optional)

When the `CF_ACCOUNT_ID` + `AIG_GATEWAY` vars are set, every provider that
declares a `gatewayPath` is called through
`https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/{gatewayPath}` —
the provider's own BYOK `Authorization` header is unchanged, and requests
show up in the dashboard (AI → AI Gateway → Logs; the free plan stores
100k logs/account). Unset vars fall back to direct endpoints, so rolling
back is just deleting two vars. Per-request caching/retries exist behind the
`AIG_CACHE_TTL` / `AIG_MAX_ATTEMPTS` constants in ai_proxy.js (default
**off** — the known OpenAI failure mode here is a hard geo-block, which
retries cannot fix and success-after-retry double-bills tokens).

- **Auth**: `Authorization: Bearer npai_…`; only the SHA-256 hash is stored
  in D1. Issue keys with `python3 tools/ai_key.py <name> [monthly_limit]`
  and run the printed SQL via `npx wrangler d1 execute nathanpenny --remote
  --command "<sql>"`.
- **Quota**: per-key monthly request cap (`api_keys.monthly_limit`, UTC
  months) enforced by an atomic conditional upsert into `ai_usage`
  (single roundtrip; no `RETURNING` row = over cap → 429). Fails open on
  D1 trouble, like the comments rate limiter.
- **Logging**: every chat call appends metadata (key, model, provider,
  status, stream, token counts, latency) to `ai_logs` via
  `ctx.waitUntil` — never prompt/response content. Streaming usage is
  scraped from the SSE tail when the upstream provides it (null otherwise),
  and latency is measured to full stream completion. Token totals also
  accumulate into `ai_usage.tokens_in/tokens_out` (per key+month).
- **Streaming**: SSE bodies are passed straight through (`body.tee()` on a
  background copy for the usage log); 300s upstream timeout, 10MB body cap.
- **CORS**: `Access-Control-Allow-Origin: *` — safe because auth is a
  header key, never cookies.
- **Geo caveat (2026-09, live-tested)**: Workers execute at the PoP nearest
  the caller, and the subrequest egresses from there. OpenAI rejects
  requests egressing from mainland-China-adjacent PoPs (HK/MO/CN) with
  `unsupported_country_region_territory` — so `gpt-*` works only when the
  caller's entry PoP egresses from a supported region. Google/Gemini and
  xAI have no such block from these PoPs. Upstream model retirements (e.g.
  `gemini-2.5-*` 404 for new keys → use `gemini-3.6-flash`) surface
  verbatim through the proxy. Workarounds: `deepseek-*` (no geo block from
  HK PoPs) and the AI Gateway route for `gpt-*` — the gateway live-test
  result: PENDING (record here after testing).

### Usage

Non-streaming:

```sh
curl https://workers.nathanpenny.fun/api/ai/v1/chat/completions \
  -H "Authorization: Bearer npai_…" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.6-flash","messages":[{"role":"user","content":"hi"}]}'
```

Streaming: add `"stream": true` — SSE chunks pass through verbatim.

OpenAI SDK (Python):

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://workers.nathanpenny.fun/api/ai/v1",
    api_key="npai_…",
)
resp = client.chat.completions.create(
    model="gemini-3.6-flash",
    messages=[{"role": "user", "content": "hi"}],
)
```

JavaScript: `new OpenAI({ baseURL: "https://workers.nathanpenny.fun/api/ai/v1", apiKey: "npai_…" })`.

Any model string routes by prefix (`gpt-`/`chatgpt-`/`o1`/`o3`/`o4` → OpenAI,
`claude-` → Anthropic, `gemini-` → Google, `grok-` → xAI, `deepseek-` →
DeepSeek, `cf-…` → Workers AI); `GET /api/ai/v1/models` lists a small
starter catalog (cosmetic — the proxy does not restrict model names).
Workers AI models are free-tier chat models only (a few big ones like
`kimi-k2.6`/`glm-5.2` need the paid Workers plan); the account gets
10,000 Neurons/day free (≈600 small llama-3.1-8b calls, ≈110 for 70b).

## D1 setup

Database `nathanpenny`, bound as `env.DB` (`wrangler.jsonc`). Tables:

- `comments`, `comment_rate` — comment feature (created manually 2026-07;
  the DDL now also lives in `workers/schema.sql`, dumped verbatim from prod)
- `api_keys`, `ai_usage`, `ai_logs` — AI proxy; (re)create idempotently:

```sh
npx wrangler d1 execute nathanpenny --remote --file workers/schema.sql
```

## Deploy

From this directory:

```sh
npx wrangler deploy
```

Deploying without the `DB` binding makes every endpoint fail with 500 —
never remove it from `wrangler.jsonc`. Validate config changes first with
`npx wrangler deploy --dry-run`.

Managed outside this repo: the `workers.nathanpenny.fun` custom domain, the
Access application + policy (Zero Trust dashboard), the secrets
(`TURNSTILE_SECRET`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `CF_AI_TOKEN` — check
with `npx wrangler secret list`), the AI Gateway itself (dashboard → AI →
AI Gateway; the `CF_ACCOUNT_ID`/`AIG_GATEWAY` vars in `wrangler.jsonc` only
point at it), and the verified email destination address behind the `NOTIFY`
send_email binding. Secrets are set with `npx wrangler secret put <NAME>`; a
provider without its secret is simply unavailable through the proxy, and the
editor fails closed with a 503 hint until `GITHUB_TOKEN` exists.

## Cron: nightly pruning

`wrangler.jsonc` registers one daily cron (03:17 UTC) → `scheduled()` in
comments.js → `pruneTables()`:

- `ai_logs` rows older than 90 days — batched id-subquery deletes (D1 has no
  `DELETE ... LIMIT`), capped rounds so a large backlog shrinks over days
  instead of blowing the invocation's CPU budget
- `ai_usage` months older than 13 months
- `comment_rate` windows older than a day (backstop for the opportunistic
  sweep already in `checkRateLimit()`)

D1's free tier enforces daily row-read limits (since 2026-09), so the
append-only tables must not grow unbounded. Prune failures are logged,
never thrown. Local test: `npx wrangler dev`, then
`curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"`.

## New-comment email notification

After a comment is successfully inserted, the Worker sends the owner a
fire-and-forget email via the `NOTIFY` send_email binding
(`ctx.waitUntil` — a failed send never affects the comment response, and
rejected comments never reach the send line). The binding's
`destination_address` in `wrangler.jsonc` pins the single allowed recipient:
the account's **verified destination address**. Sends to verified
destination addresses are free on every plan and never count against quotas.

Content is deliberately minimal — commenter name + a 300-char excerpt; no
commenter email, no IP, no full text. From: `noreply@nathanpenny.fun`,
which requires the `nathanpenny.fun` sending domain onboarded
(`npx wrangler email sending enable nathanpenny.fun`, adds SPF/DKIM DNS).
Prerequisite: verify the owner address under Email → Destination addresses
first. Without the binding deployed the feature is simply off.

## Turnstile (comment spam protection)

`POST /comments` requires a valid Cloudflare Turnstile token from the comment
form on the Contact page. The widget's site key is public and lives in
`pages/contact.html`; the **secret key must never be committed to this repo** —
store it in the Worker's secret store:

```sh
wrangler secret put TURNSTILE_SECRET
# paste the secret when prompted, then deploy the worker
```

Verification rules in `verifyTurnstile()`:

- `success === true` from `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- token `action` must equal `comment` (set via `data-action` on the widget)
- token `hostname` must be one of `nathanpenny.fun`, `blog.nathanpenny.fun`,
  `nathanpenny520.github.io` — localhost is deliberately NOT allowed, so local
  end-to-end testing of the comment post will get a 403. To test the full flow
  locally, temporarily swap in Cloudflare's official test keys
  (sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`),
  then swap back before deploying.

If `TURNSTILE_SECRET` is not set the endpoint fails closed with a 500, so
comments cannot be posted until the secret is configured.

## Notes

- CORS: `/comments` only echoes allowlisted origins (`nathanpenny.fun`,
  `blog.nathanpenny.fun`, `nathanpenny520.github.io`, `localhost:8080`);
  `/api/ai` allows `*` (bearer-key auth). The email field is stored but never
  returned by `GET /comments`.
- The rate limiter fails open on D1 trouble (comments keep working if the
  `comment_rate` table is missing); Turnstile still guards the write path.
- Local dev quirk: `wrangler d1 execute --local` storage follows the current
  directory — run it from `workers/` so it shares state with `wrangler dev`.
