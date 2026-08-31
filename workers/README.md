# Comments Backend

This is the updated Cloudflare Worker code that adds a `/comments` endpoint to your existing visitor form worker.

## What changed

Your original worker only handled `GET /` and `POST /` for visitor messages.  
This version keeps those endpoints and adds:

- `GET /comments` — returns all comments
- `POST /comments` — creates a new comment

## D1 setup

Run this SQL in your D1 database to create the comments table:

```sql
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

The `visitors` table is assumed to already exist from your original worker.

## Deploy

The Worker is `nathanpenny-api`; the D1 database `nathanpenny` is bound as
`env.DB` via `wrangler.jsonc`. Never deploy without that binding — every
endpoint fails with 500 without it. From this directory:

```sh
npx wrangler deploy
```

The custom domain `workers.nathanpenny.fun` and the `TURNSTILE_SECRET` secret
are managed outside this repo (dashboard / secret store) and survive deploys;
check the secret with `npx wrangler secret list`.

## Turnstile (comment spam protection)

`POST /comments` requires a valid Cloudflare Turnstile token from the comment
form on the Contact page. The widget's site key is public and lives in
`pages/contact.html`; the **secret key must never be committed to this repo** —
store it in the Worker's secret store and deploy:

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

- CORS origins are kept the same pattern as your original worker.
- The `email` field is stored but not returned by `GET /comments`.
