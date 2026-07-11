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

Replace your current Worker code with the contents of `comments.js` and deploy.

## Notes

- CORS origins are kept the same pattern as your original worker.
- The `email` field is stored but not returned by `GET /comments`.
