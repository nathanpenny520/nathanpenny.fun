// OpenAI-compatible AI proxy served under /api/ai/v1/ (see workers/README.md).
// Auth: bearer keys whose SHA-256 hashes live in the api_keys D1 table
// (generate with tools/ai_key.py). A monthly request-count quota breaker lives
// in ai_usage; every chat call appends a metadata-only row to ai_logs — never
// prompt or response content. The single upstream is Cloudflare Workers AI via
// its OpenAI-compatible REST route (free 10,000 Neurons/day, no third-party
// keys): the request body passes through untouched, only the URL and auth
// header change, plus one model-string rewrite (cf-* → @cf/*).

const PROVIDERS = [
  {
    // Cloudflare's own Workers AI via its OpenAI-compatible REST route
    // (developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility).
    // CF_AI_TOKEN is a Cloudflare API token scoped to Workers AI — no
    // third-party key needed and the free allocation is 10,000 Neurons/day.
    name: "workers-ai",
    secret: "CF_AI_TOKEN",
    prefixes: ["cf-"],
    endpoint: null, // built per-account in upstreamUrl()
    // Cosmetic catalog (any model string passes through as cf-… → @cf/…).
    // Free-tier chat models only — a few big ones (kimi-k2.6, glm-5.2, …)
    // require the paid Workers plan. Rough Neuron cost per small call:
    // llama-3.1-8b-fast ≈ 15, llama-3.3-70b ≈ 90 (10k free per day).
    models: [
      "cf-meta/llama-3.1-8b-instruct-fp8-fast",
      "cf-qwen/qwen3-30b-a3b-fp8",
      "cf-meta/llama-3.3-70b-instruct-fp8-fast",
      "cf-google/gemma-3-12b-it",
      "cf-deepseek-ai/deepseek-r1-distill-qwen-32b"
    ]
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

// Workers AI's OpenAI-compatible endpoint, built per-account (the CF_ACCOUNT_ID
// var). An AI Gateway fronting was live-tested 2026-09 and removed: it does
// not bypass OpenAI's geo-block and a single free upstream gains nothing
// from it.
function upstreamUrl(env) {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/chat/completions`;
}

// Shared with comments.js — the site avatar chat reuses the quota breaker,
// the usage logger and the upstream URL builder.
export { consumeQuota, writeLog, extractUsage, upstreamUrl };

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

// Single-reader pump: forward every upstream chunk to the client-side
// TransformStream while keeping a bounded tail (usage, when present, rides in
// the final chunks). Client writes are fire-and-forget (a disconnected client
// must never stall the drain). The log write happens BEFORE writer.close() on
// purpose: waitUntil work issued after a streamed response has finished never
// lands in production (the D1 call hangs silently), so the log must be
// written while the invocation is still actively streaming. The cost is that
// the client's stream end waits for one D1 write — imperceptible in practice.
async function pumpStream(env, entry, stream, writable) {
  const decoder = new TextDecoder();
  let tail = "";
  const reader = stream.getReader();
  const writer = writable.getWriter();
  const logUsage = () => {
    const raw = lastUsageObject(tail);
    const usage = raw ? tokensFromUsage(raw) : null;
    return writeLog(env, {
      keyId: entry.keyId,
      model: entry.model,
      provider: entry.provider,
      status: entry.status,
      stream: true,
      tokensIn: usage ? usage.in : null,
      tokensOut: usage ? usage.out : null,
      // Measured across the whole drain, so long generations log their full
      // duration instead of the time-to-first-byte.
      latencyMs: Date.now() - entry.startedAt
    });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tail += decoder.decode(value, { stream: true });
      if (tail.length > 256 * 1024) tail = tail.slice(-256 * 1024);
      writer.write(value).catch(() => { /* client gone */ });
    }
    await logUsage();
    writer.close().catch(() => { /* client gone */ });
  } catch (error) {
    // Upstream aborts are normal (client cancels propagate); log what we have.
    try {
      await logUsage();
    } catch (e) {
      // writeLog swallows internally; this can only be a synchronous surprise.
      console.error("pumpStream logUsage failed:", e);
    }
    writer.abort(error).catch(() => { /* already closed */ });
  }
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
      // Token totals ride into ai_usage as a separate upsert — the quota
      // breaker only ever creates rows for capped keys, so unlimited keys
      // would otherwise never accumulate usage. Recomputing the month here
      // (instead of threading it through) keeps call sites simple.
      if (entry.tokensIn !== null || entry.tokensOut !== null) {
        await env.DB.prepare(
          `INSERT INTO ai_usage (key_id, month, requests, tokens_in, tokens_out)
           VALUES (?, ?, 0, ?, ?)
           ON CONFLICT (key_id, month) DO UPDATE SET
             tokens_in = ai_usage.tokens_in + excluded.tokens_in,
             tokens_out = ai_usage.tokens_out + excluded.tokens_out`
        ).bind(
          entry.keyId,
          new Date().toISOString().slice(0, 7),
          entry.tokensIn ?? 0,
          entry.tokensOut ?? 0
        ).run();
      }
      await env.DB.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(entry.keyId)
        .run();
    } catch (error) {
      // Never break the response path, but leave a trace for observability.
      console.error("writeLog failed:", error && (error.stack || error.message || error));
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
  // Byte-exact size check on the raw buffer: UTF-16 string lengths
  // under-count multi-byte bodies, so never measure the decoded text.
  let body;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return aiError(413, "Request body too large (10MB limit).", "invalid_request_error");
    }
    body = JSON.parse(new TextDecoder().decode(buf));
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
  if (provider.name === "workers-ai" && !env.CF_ACCOUNT_ID) {
    return aiError(503, "Workers AI needs the CF_ACCOUNT_ID var on this Worker.", "api_error");
  }

  // Workers AI's REST route expects "@cf/{author}/{model}"; clients send the
  // friendlier "cf-{author}/{model}" form that the /models catalog lists.
  if (provider.name === "workers-ai") body.model = "@cf/" + model.slice(3);

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
    upstream = await fetch(upstreamUrl(env), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${upstreamKey}`
      },
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

  // Streaming: forward the SSE bytes through a TransformStream; the same
  // pump accumulates the usage tail and writes the log before closing.
  if (body.stream === true && upstream.body) {
    const { readable, writable } = new TransformStream();
    ctx.waitUntil(
      pumpStream(env, {
        keyId: key.id,
        model,
        provider: provider.name,
        status: upstream.status,
        startedAt
      }, upstream.body, writable)
    );
    return new Response(readable, { status: upstream.status, headers });
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
