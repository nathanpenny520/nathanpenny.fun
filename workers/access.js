// Cloudflare Access JWT verification (defense in depth), shared by every
// Access-protected surface: the /admin page (image uploader + markdown
// editor), /upload, and the /admin/api/* editor endpoints.
// The Access application at the edge already stops unauthenticated browsers;
// this check additionally rejects any request that never went through it
// (e.g. via the worker.dev domain). Fail-closed: missing config -> 401.

const JSON_HEADERS = { "Content-Type": "application/json" };

let accessJwksCache = null; // { jwks, fetchedAt }
const ACCESS_JWKS_TTL_MS = 24 * 60 * 60 * 1000;

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getAccessJwks(teamDomain) {
  if (accessJwksCache && Date.now() - accessJwksCache.fetchedAt < ACCESS_JWKS_TTL_MS) {
    return accessJwksCache.jwks;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("JWKS fetch failed");
  const jwks = await res.json();
  accessJwksCache = { jwks, fetchedAt: Date.now() };
  return jwks;
}

// True only with a fresh Access JWT correctly signed for this application.
// ADMIN_BYPASS exists solely for `wrangler dev` via the gitignored
// workers/.dev.vars and must NEVER be set on a deployment.
export async function verifyAccess(request, env) {
  if (env.ADMIN_BYPASS === "1") return true;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    console.log("access verify: fail (missing config)");
    return false;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    console.log("access verify: fail (no JWT header on request)");
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    console.log("access verify: fail (malformed JWT)");
    return false;
  }

  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const jwks = await getAccessJwks(env.ACCESS_TEAM_DOMAIN);
    const jwk = (jwks.keys || []).find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) {
      console.log("access verify: fail (kid not in JWKS)");
      return false;
    }

    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!ok) {
      console.log("access verify: fail (bad signature)");
      return false;
    }

    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (!claims.exp || Date.now() / 1000 >= claims.exp) {
      console.log("access verify: fail (expired)");
      return false;
    }
    // Claim aud may be a string OR an array (RFC 7519 — this app's JWTs carry
    // multiple audiences because it has two destinations); the configured var
    // is comma-separated so two Access apps can also share it.
    const configuredAuds = String(env.ACCESS_AUD).split(",");
    const claimAuds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const audOk = claimAuds.some((a) => configuredAuds.includes(String(a)));
    if (!audOk) {
      // Never log token contents — just the decision inputs' shapes.
      console.log(`access verify: fail (aud mismatch, claim aud type ${typeof claims.aud})`);
    }
    return audOk;
  } catch (error) {
    console.log(`access verify: fail (exception: ${error.message})`);
    return false;
  }
}

export function accessDenied() {
  return new Response(
    JSON.stringify({ error: "Cloudflare Access verification failed. Sign in via https://workers.nathanpenny.fun/admin." }),
    { status: 401, headers: JSON_HEADERS }
  );
}
