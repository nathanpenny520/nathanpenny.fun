// OpenAI-compatible AI proxy served under /api/ai/v1/ (see workers/README.md).
// Auth: bearer keys whose SHA-256 hashes live in the api_keys D1 table
// (generate with tools/ai_key.py). A monthly request-count quota breaker lives
// in ai_usage; every chat call appends a metadata-only row to ai_logs — never
// prompt or response content. Upstreams are the four providers' official
// OpenAI-compatibility endpoints: the request body passes through untouched,
// only the URL and auth header change.

// Bearer auth is used for every upstream on purpose: each compatibility layer
// is built for the OpenAI SDK, which only ever sends `Authorization: Bearer`.
const PROVIDERS = [
  {
    name: "openai",
    secret: "OPENAI_API_KEY",
    prefixes: ["gpt-", "chatgpt-", "o1", "o3", "o4"],
    endpoint: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"]
  },
  {
    name: "anthropic",
    secret: "ANTHROPIC_API_KEY",
    prefixes: ["claude-"],
    endpoint: "https://api.anthropic.com/v1/chat/completions",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]
  },
  {
    name: "google",
    secret: "GEMINI_API_KEY",
    prefixes: ["gemini-", "models/gemini-"],
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    // Cosmetic catalog (any model string passes through). gemini-2.5-* was
    // retired for new API keys (2026-09, upstream 404); 3.6-flash confirmed
    // live through the proxy.
    models: ["gemini-3.6-flash"]
  },
  {
    name: "xai",
    secret: "XAI_API_KEY",
    prefixes: ["grok-"],
    endpoint: "https://api.x.ai/v1/chat/completions",
    models: ["grok-4", "grok-4-fast-reasoning", "grok-code-fast-1"]
  }
];

const MAX_BODY_BYTES = 10 * 1024 * 1024;
// Long generations still complete; waiting on I/O costs no CPU time. Upstream
// errors (401/400/…) pass through verbatim so misconfigurations are visible.
const UPSTREAM_TIMEOUT_MS = 300_000;

// /api/ai is safe to open to all origins: auth is a bearer key in a header,
// never cookies, so no credential can leak cross-site.
const AI_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};

function aiJson(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...AI_CORS, "Content-Type": "application/json" }
  });
}

function aiError(status, message, type) {
  return aiJson(status, { error: { message, type, code: status } });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function providerFor(model) {
  return PROVIDERS.find((p) => p.prefixes.some((pre) => model.startsWith(pre))) || null;
}

// Single-roundtrip monthly quota breaker: the upsert increments only while the
// counter sits below the cap, and no RETURNING row means the budget is spent.
// Fails open on D1 trouble, matching checkRateLimit() in comments.js.
async function consumeQuota(env, keyId, monthlyLimit, month) {
  if (monthlyLimit === null || monthlyLimit === undefined) return true;
  if (monthlyLimit < 1) return false;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO ai_usage (key_id, month, requests) VALUES (?, ?, 1)
       ON CONFLICT (key_id, month) DO UPDATE SET requests = ai_usage.requests + 1
       WHERE ai_usage.requests < ?
       RETURNING requests`
    ).bind(keyId, month, monthlyLimit).first();
    return !!row;
  } catch (error) {
    return true;
  }
}

function tokensFromUsage(usage) {
  const tin = Number(usage.prompt_tokens);
  const tout = Number(usage.completion_tokens);
  return {
    in: Number.isFinite(tin) ? tin : null,
    out: Number.isFinite(tout) ? tout : null
  };
}

// The last "usage" object in a JSON body or SSE tail. Brace-counting instead
// of a line regexp because usage carries nested *_tokens_details objects.
function lastUsageObject(text) {
  let idx = text.lastIndexOf('"usage"');
  while (idx !== -1) {
    const start = text.indexOf("{", idx);
    if (start !== -1) {
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        if (text[i] === "{") {
          depth++;
        } else if (text[i] === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.slice(start, i + 1));
            } catch (error) {
              break;
            }
          }
        }
      }
    }
    idx = text.lastIndexOf('"usage"', idx - 1);
  }
  return null;
}

function extractUsage(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    if (parsed && parsed.usage) return tokensFromUsage(parsed.usage);
  } catch (error) {
    const usage = lastUsageObject(responseText);
    if (usage) return tokensFromUsage(usage);
  }
  return null;
}

// Drain the tee'd stream copy in the background, keeping only a bounded tail
// (usage, when present, rides in the final chunks). Logs whatever it finds —
// providers without usage in their SSE simply log nulls.
function collectStreamUsage(stream, onDone) {
  const decoder = new TextDecoder();
  let tail = "";
  return (async () => {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        tail += decoder.decode(value, { stream: true });
        if (tail.length > 256 * 1024) tail = tail.slice(-256 * 1024);
      }
      tail += decoder.decode();
    } catch (error) {
      // Client disconnects / aborted upstreams are normal; log what we have.
    }
    const usage = lastUsageObject(tail);
    onDone(usage ? tokensFromUsage(usage) : null);
  })();
}

// Log writing happens inside ctx.waitUntil, so a broken logger can never
// affect the response.
function writeLog(env, entry) {
  return (async () => {
    try {
      await env.DB.prepare(
        `INSERT INTO ai_logs (key_id, model, provider, status, stream, tokens_in, tokens_out, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        entry.keyId,
        entry.model,
        entry.provider,
        entry.status,
        entry.stream ? 1 : 0,
        entry.tokensIn,
        entry.tokensOut,
        entry.latencyMs
      ).run();
      await env.DB.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(entry.keyId)
        .run();
    } catch (error) {
      // Ignore: logging must not break the response path.
    }
  })();
}

export async function handleAi(request, env, ctx, url) {
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: AI_CORS });
  }

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return aiError(401, "Missing API key. Send 'Authorization: Bearer <key>'.", "invalid_request_error");
  }

  let key;
  try {
    key = await env.DB.prepare(
      "SELECT id, name, monthly_limit, enabled FROM api_keys WHERE key_hash = ?"
    ).bind(await sha256Hex(token)).first();
  } catch (error) {
    return aiError(503, "Key store unavailable.", "api_error");
  }
  if (!key) return aiError(401, "Invalid API key.", "invalid_request_error");
  if (!key.enabled) return aiError(403, "This API key is disabled.", "invalid_request_error");

  if (path === "/api/ai/v1/models" && request.method === "GET") {
    const data = PROVIDERS.filter((p) => env[p.secret]).flatMap((p) =>
      p.models.map((id) => ({ id, object: "model", owned_by: p.name }))
    );
    return aiJson(200, { object: "list", data });
  }

  if (path === "/api/ai/v1/chat/completions" && request.method === "POST") {
    return handleChatCompletions(request, env, ctx, key);
  }

  return aiError(
    404,
    "Not found. POST /api/ai/v1/chat/completions or GET /api/ai/v1/models.",
    "invalid_request_error"
  );
}

async function handleChatCompletions(request, env, ctx, key) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return aiError(413, "Request body too large (10MB limit).", "invalid_request_error");
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return aiError(413, "Request body too large (10MB limit).", "invalid_request_error");
    }
    body = JSON.parse(raw);
  } catch (error) {
    return aiError(400, "Request body must be valid JSON.", "invalid_request_error");
  }

  const model = typeof body.model === "string" ? body.model : "";
  const provider = providerFor(model);
  if (!provider) {
    return aiError(
      400,
      `Unknown model prefix '${model}'. Supported prefixes: ${PROVIDERS.flatMap((p) => p.prefixes).join(", ")}`,
      "invalid_request_error"
    );
  }

  const upstreamKey = env[provider.secret];
  if (!upstreamKey) {
    return aiError(503, `Upstream '${provider.name}' is not configured on this Worker.`, "api_error");
  }

  // YYYY-MM in UTC — the same clock the breaker counts against.
  const month = new Date().toISOString().slice(0, 7);
  if (!(await consumeQuota(env, key.id, key.monthly_limit, month))) {
    return aiError(
      429,
      `Monthly request quota of ${key.monthly_limit} exhausted for key '${key.name}'.`,
      "insufficient_quota"
    );
  }

  const startedAt = Date.now();
  let upstream;
  try {
    upstream = await fetch(provider.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${upstreamKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (error) {
    ctx.waitUntil(
      writeLog(env, {
        keyId: key.id, model, provider: provider.name, status: 502,
        stream: false, tokensIn: null, tokensOut: null, latencyMs: Date.now() - startedAt
      })
    );
    return aiError(502, `Upstream '${provider.name}' unreachable: ${error.message}`, "api_error");
  }

  const headers = {
    ...AI_CORS,
    "Content-Type": upstream.headers.get("Content-Type") || "application/json"
  };

  // Streaming: pass the SSE bytes straight through; drain the tee'd copy in
  // the background for the usage log.
  if (body.stream === true && upstream.body) {
    const [toClient, forLog] = upstream.body.tee();
    const latencyMs = Date.now() - startedAt;
    ctx.waitUntil(
      collectStreamUsage(forLog, (usage) =>
        writeLog(env, {
          keyId: key.id, model, provider: provider.name, status: upstream.status,
          stream: true, tokensIn: usage ? usage.in : null, tokensOut: usage ? usage.out : null,
          latencyMs
        })
      )
    );
    return new Response(toClient, { status: upstream.status, headers });
  }

  const responseText = await upstream.text();
  const usage = extractUsage(responseText);
  ctx.waitUntil(
    writeLog(env, {
      keyId: key.id, model, provider: provider.name, status: upstream.status,
      stream: false, tokensIn: usage ? usage.in : null, tokensOut: usage ? usage.out : null,
      latencyMs: Date.now() - startedAt
    })
  );
  return new Response(responseText, { status: upstream.status, headers });
}
