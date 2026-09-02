# Worker Backend: comments + image uploader + AI proxy

Cloudflare Worker behind `https://workers.nathanpenny.fun` (custom domain;
the `*.workers.dev` URL also exists but admin routes reject it — see Access
below). Three feature groups:

## Endpoints

| Method | Path                           | Protection              | Purpose                                        |
|--------|--------------------------------|-------------------------|------------------------------------------------|
| GET    | `/comments`                    | public                  | List comments (`email` deliberately excluded)  |
| POST   | `/comments`                    | public                  | Create a comment (rate limit + Turnstile)      |
| GET    | `/admin`                       | Cloudflare Access       | Self-hosted image upload page (admin_page.js)  |
| POST   | `/upload`                      | Cloudflare Access       | Multipart images → R2 `img/` prefix            |
| GET    | `/upload?list=1[&cursor=…]`    | Cloudflare Access       | Recent uploads (newest first)                  |
| DELETE | `/upload?key=img/…`            | Cloudflare Access       | Delete one object (`img/` prefix only)         |
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
  25MB cap, light magic-byte sniffing.
- The upload page is a fully self-contained HTML exported by `admin_page.js`
  (drag & drop + clipboard paste + copy-URL/copy-markdown + delete).

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

Every upstream uses `Authorization: Bearer` (all four compatibility layers
are built for the OpenAI SDK, which only sends Bearer). A provider whose
secret is unset returns 503; unknown prefixes return 400 listing them.

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
  scraped from the SSE tail when the upstream provides it (null otherwise).
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
  verbatim through the proxy.

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
`claude-` → Anthropic, `gemini-` → Google, `grok-` → xAI); `GET
/api/ai/v1/models` lists a small starter catalog (cosmetic — the proxy does
not restrict model names).

## D1 setup

Database `nathanpenny`, bound as `env.DB` (`wrangler.jsonc`). Tables:

- `comments`, `comment_rate` — comment feature (created manually, 2026-07)
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
Access application + policy (Zero Trust dashboard), and the secrets
(`TURNSTILE_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `XAI_API_KEY` — check with `npx wrangler secret list`).
Provider keys are set with `npx wrangler secret put <NAME>`; a provider
without its secret is simply unavailable through the proxy.

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
