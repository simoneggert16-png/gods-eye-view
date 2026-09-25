/**
 * OpenSky bridge worker (Cloudflare Workers, zero dependencies) for God's Eye View.
 *
 * WHY: Render's free egress cannot reach opensky-network.org at all (TCP fetch
 * fails before any HTTP exchange, so OAuth credentials alone cannot fix it).
 * Cloudflare's egress is not blocked, so this worker fetches the worldwide
 * OpenSky snapshot from Cloudflare's network and hands it to the Render proxy,
 * which is configured via OPENSKY_BRIDGE_URL / OPENSKY_BRIDGE_TOKEN.
 *
 * SETUP (5–10 min, Cloudflare dashboard, no CLI needed):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
 *      → Deploy, then Edit code → paste this file → Save and deploy.
 *   2. Worker → Settings → Variables and Secrets → add secrets:
 *        OPENSKY_CLIENT_ID     = <your opensky client id>
 *        OPENSKY_CLIENT_SECRET = <your opensky client secret>
 *        BRIDGE_TOKEN          = <any long random string you invent>
 *   3. Copy the worker URL, e.g. https://gev-opensky-bridge.<you>.workers.dev
 *   4. Render dashboard → service → Environment → set:
 *        OPENSKY_BRIDGE_URL   = <worker URL>
 *        OPENSKY_BRIDGE_TOKEN = <same BRIDGE_TOKEN as above>
 *      Save (Render redeploys automatically).
 *   5. Verify: GET <worker URL> with header `Authorization: Bearer <BRIDGE_TOKEN>`
 *      must return OpenSky JSON (`{"time":...,"states":[...]}`).
 *
 * COST: Cloudflare Workers free plan = 100k requests/day. The Render proxy
 * polls at most every ~9–30 s (≈3–10k/day), and this worker edge-caches the
 * snapshot for 15 s, so usage stays far inside the free quota. OpenSky credit
 * usage is unchanged (one worldwide /states/all per cache window).
 */

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all?extended=1';
const EDGE_CACHE_KEY = 'https://gev-opensky-bridge.internal/__opensky-states';
const EDGE_CACHE_TTL_SECONDS = 15;

/** @type {string|null} Cached OAuth bearer token (isolate-local). */
let _token = null;
/** @type {number} Epoch-ms when the cached token expires. */
let _tokenExpiry = 0;

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function getToken(env) {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
  const clientId = env.OPENSKY_CLIENT_ID;
  const clientSecret = env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:
        `grant_type=client_credentials` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&client_secret=${encodeURIComponent(clientSecret)}`,
    });
  } catch (err) {
    throw new Error(`token fetch failed: ${err?.message || String(err)}`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data?.access_token) {
    _token = null;
    _tokenExpiry = 0;
    const detail = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new Error(`token rejected: ${detail}`);
  }
  _token = data.access_token;
  const expiresIn = Number(data.expires_in);
  _tokenExpiry = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 1800) * 1000;
  return _token;
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string,string>} env
   * @param {{waitUntil:(promise:Promise<unknown>)=>void}} ctx
   */
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method !== 'GET') return jsonResponse({ error: 'Method Not Allowed' }, 405);

    if (env.BRIDGE_TOKEN) {
      const auth = request.headers.get('authorization') || '';
      if (auth !== `Bearer ${env.BRIDGE_TOKEN}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
    }

    try {
      const cache = caches.default;
      const cached = await cache.match(EDGE_CACHE_KEY);
      if (cached) return cached;

      const token = await getToken(env);
      if (!token) return jsonResponse({ error: 'OpenSky auth failed' }, 502);

      const upstream = await fetch(STATES_URL, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      const body = await upstream.text();
      const response = new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
          'Access-Control-Allow-Origin': '*',
        },
      });
      if (upstream.ok) ctx.waitUntil(cache.put(EDGE_CACHE_KEY, response.clone()));
      return response;
    } catch (err) {
      return jsonResponse({ error: `Bridge error: ${err?.message || String(err)}` }, 502);
    }
  },
};
