# Comments Backend

Cloudflare Worker behind `https://workers.nathanpenny.fun`. Single purpose:
the comment feature on the Contact page.

## Endpoints

| Method | Path        | Purpose                                          |
|--------|-------------|--------------------------------------------------|
| GET    | `/comments` | List comments (`email` deliberately excluded)    |
| POST   | `/comments` | Create a comment                                 |
| *      | anything else | 404                                            |

`POST /comments` is guarded by two layers, in order:

1. **Per-IP rate limit** — 5 attempts per 60s window, keyed on
   `CF-Connecting-IP` and counted in the `comment_rate` D1 table (see
   `checkRateLimit()` in `comments.js`). Exceeding it returns 429 before any
   parsing happens. (A Workers rate-limit binding was tried first but is
   silently a no-op on this account, so the cap lives in D1.)
2. **Cloudflare Turnstile** — the `cf-turnstile-response` token from the
   Contact form is verified server-side (see below). Failure returns 403.

## D1 setup

The D1 database `nathanpenny` is bound as `env.DB` (see `wrangler.jsonc`).
Two tables back the API:

```sql
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-IP rate limit counters for POST /comments (see checkRateLimit()).
CREATE TABLE IF NOT EXISTS comment_rate (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
```

(The legacy `visitors` table and its root `/` endpoints were removed in
Sep 2026; the table has been dropped.)

## Deploy

From this directory:

```sh
npx wrangler deploy
```

Deploying without the `DB` binding makes every endpoint fail with 500 —
never remove it from `wrangler.jsonc`. Validate config changes first with
`npx wrangler deploy --dry-run`.

The custom domain `workers.nathanpenny.fun` and the `TURNSTILE_SECRET` secret
are managed outside this repo (dashboard / secret store) and survive deploys;
check the secret with `npx wrangler secret list`.

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

- CORS: responses only carry `Access-Control-Allow-Origin` for allowlisted
  origins (`nathanpenny.fun`, `blog.nathanpenny.fun`,
  `nathanpenny520.github.io`, `localhost:8080`); other origins get none.
- The `email` field is stored but never returned by `GET /comments`.
- The rate limiter fails open on D1 trouble (comments keep working if the
  `comment_rate` table is missing); Turnstile still guards the write path.
