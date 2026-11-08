/**
 * PIN gate ("wall") for the Vercel deployment.
 *
 * Upstream `bilawalsidhu/gods-eye-view` v0.3.0 has no access control at all: every
 * `/api/*` route is an open proxy that spends *Simon's* paid quotas (TomTom,
 * Gemini, FIRMS, AISStream) and returns live OSINT. On Vercel Hobby the platform
 * offers no PIN-style protection — "Password Protection" is a Pro feature and
 * "Vercel Authentication" only does SSO — and legacy `routes` routing (which this
 * deployment needs, because the CLI generates a single-segment `/api/([^/]+)`
 * pattern without it) is not compatible with edge Middleware. So the gate lives
 * here: one small function for the document + PIN form, and one check inside the
 * API dispatcher.
 *
 * Contract
 *  - `GEV_WALL_PIN` (Vercel Secret). Unset or empty → the gate is disabled, so a
 *    missing secret can never brick the deployment.
 *  - Unlock: `POST /api/wall` with `pin=<PIN>` (form or JSON). On success a signed
 *    cookie `gev_wall=<expiry>.<hmac>` is set (HttpOnly, SameSite=Lax, Secure,
 *    30 days by default, `GEV_WALL_TTL_S` to override).
 *  - `GET /api/wall` → `{status:"open"|"locked"}` JSON.
 *  - Document routes (`^/$`, `^/index.html$`, and the SPA catch-all) point at
 *    `api/wall-shell.js`, which serves `dist/index.html` (bundled into that
 *    function via `includeFiles`) when unlocked and the PIN form when locked.
 *    If the shell is not in the bundle the response is an explicit
 *    `503 {error:"app_shell_missing"}` — never a redirect, because the catch-all
 *    routes back here and a redirect would loop.
 *  - `/api/*` inside the dispatcher: without a valid cookie every data endpoint
 *    answers `401 {error:"pin_required"}`.
 *
 * Brute force: 8 failures per IP lock the attempt route for 15 minutes (per
 * instance — Vercel has no shared store here) and every wrong attempt costs a
 * 350 ms delay, on top of the numeric PIN being long enough that 10^8 guesses at
 * that rate is not a realistic campaign. `GEV_WALL_MAX_ATTEMPTS` /
 * `GEV_WALL_LOCK_MS` override.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** @type {string} Cookie that carries the unlock token. */
export const WALL_COOKIE = 'gev_wall';

function intFromEnv(key, fallback) {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function wallPin() {
  return String(process.env.GEV_WALL_PIN || '').trim();
}

/** False when no PIN is configured — the whole gate stays out of the way. */
export function wallEnabled() {
  return wallPin().length > 0;
}

function pinKey() {
  // The PIN never becomes the HMAC key directly: it is hashed first so the raw
  // secret cannot leak through any key-inspection path, and the derived key is
  // stable for the lifetime of the deployment.
  return crypto.createHash('sha256').update(wallPin(), 'utf8').digest();
}

function sign(expirySeconds) {
  return crypto
    .createHmac('sha256', pinKey())
    .update(String(expirySeconds), 'utf8')
    .digest('hex');
}

export function createWallToken(nowSeconds = Math.floor(Date.now() / 1000)) {
  const ttl = intFromEnv('GEV_WALL_TTL_S', 60 * 60 * 24 * 30);
  const expiry = nowSeconds + ttl;
  return { value: `${expiry}.${sign(expiry)}`, maxAgeSeconds: ttl };
}

/**
 * Validate `<expiry>.<hmac>`.
 * @param {string|undefined|null} candidate Cookie value.
 */
export function verifyWallToken(
  candidate,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const raw = String(candidate || '').trim();
  if (!wallEnabled() || !raw.includes('.')) return false;
  const [expiryRaw, signatureRaw] = raw.split('.');
  const expiry = Number(expiryRaw);
  const signature = String(signatureRaw || '');
  if (!Number.isFinite(expiry) || expiry <= nowSeconds) return false;
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = sign(expiry);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Read a cookie value out of a raw `Cookie` header without external deps. */
export function cookieValue(req, name = WALL_COOKIE) {
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function requestIsUnlocked(req) {
  if (!wallEnabled()) return true;
  return verifyWallToken(cookieValue(req));
}

// --- brute-force brake ------------------------------------------------------
/** @type {Map<string, {count: number, lockedUntil: number}>} */
const attempts = new Map();

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '');
  const first = forwarded.split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

export function attemptLockRemainingMs(req, now = Date.now()) {
  const record = attempts.get(clientIp(req));
  if (!record) return 0;
  return Math.max(0, record.lockedUntil - now);
}

export function registerFailedAttempt(req) {
  const ip = clientIp(req);
  const max = intFromEnv('GEV_WALL_MAX_ATTEMPTS', 8);
  const lockMs = intFromEnv('GEV_WALL_LOCK_MS', 15 * 60 * 1000);
  const record = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= max) {
    record.lockedUntil = Date.now() + lockMs;
    record.count = 0;
  }
  attempts.set(ip, record);
  if (attempts.size > 500) {
    for (const [key, value] of attempts) {
      if (value.lockedUntil < Date.now()) attempts.delete(key);
    }
  }
  return new Promise((resolve) => setTimeout(resolve, 350));
}

function clearFailedAttempts(req) {
  attempts.delete(clientIp(req));
}

// --- body + response helpers ------------------------------------------------
async function readPin(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) break;
    chunks.push(bytes);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers?.['content-type'] || '');
  if (type.includes('application/json')) {
    try {
      return String(JSON.parse(text)?.pin || '');
    } catch {
      return '';
    }
  }
  try {
    return new URLSearchParams(text).get('pin') || '';
  } catch {
    return '';
  }
}

function send(res, status, headers, body) {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': String(payload.length),
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, object, headers = {}) {
  const payload = Buffer.from(JSON.stringify(object));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': String(payload.length),
    ...headers,
  });
  res.end(payload);
}

/**
 * Self-contained PIN form: no JS (the deployment CSP forbids inline scripts), no
 * external assets, so it renders even when nothing else of the app has loaded.
 */
export function pinPageHtml(error = '') {
  const notice = error
    ? `<p class="bad">${error}</p>`
    : '<p>Die Karte und alle Live-Daten liegen hinter dieser Tür.</p>';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>God&#39;s Eye View — PIN</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 32px 20px 40px;
    background: #07090c;
    color: #f3f5f7;
    font: 15px/1.5 "Segoe UI", system-ui, sans-serif;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 16px;
    border: 1px solid rgba(243, 245, 247, 0.12);
    pointer-events: none;
  }
  .meta {
    position: fixed;
    top: 28px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    pointer-events: none;
  }
  .meta span {
    font-size: 11px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #a8b0b8;
  }
  .meta b {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #f3f5f7;
  }
  .meta-l { left: 32px; text-align: left; }
  .meta-r { right: 32px; text-align: right; }
  form { width: min(420px, 100%); margin: 0; text-align: center; }
  .kicker, h1, .tag, input, button, small {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .kicker, .tag {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.28em;
    text-transform: uppercase;
  }
  p.kicker { margin: 0 0 14px; color: #c5cad0; }
  h1 {
    margin: 0;
    font-size: clamp(18px, 4.6vw, 26px);
    font-weight: 500;
    letter-spacing: 0.16em;
    line-height: 1.15;
    text-transform: uppercase;
    color: #f7f8f8;
  }
  h1 span { color: #00d4ff; font-weight: 400; }
  p.tag { margin: 12px 0 0; letter-spacing: 0.32em; color: #c2c8ce; }
  .rule {
    width: 36px; height: 1px; margin: 24px auto 22px;
    background: rgba(243, 245, 247, 0.42);
  }
  form > p:not(.kicker):not(.tag) { max-width: 36ch; margin: 0 auto 26px; color: #c8ced4; }
  form > p.bad { color: #ff6b6b; font-weight: 600; }
  input {
    display: block; width: min(100%, 336px); height: 54px;
    margin: 0 auto 12px; padding: 0 14px;
    border: 1px solid rgba(243, 245, 247, 0.4); border-radius: 0;
    background: #10141a; color: #f7f8f8;
    font-size: 18px; letter-spacing: 0.35em; text-align: center;
    outline: none;
  }
  input:focus { border-color: #f7f8f8; }
  button {
    display: block; width: min(100%, 336px); height: 48px;
    margin: 0 auto; padding: 0;
    border: 1px solid rgba(243, 245, 247, 0.5); border-radius: 0;
    background: #f3f5f7; color: #07090c;
    font-size: 13px; font-weight: 600; letter-spacing: 0.16em;
    text-transform: uppercase; cursor: pointer;
  }
  button:hover { background: #ffffff; }
  small {
    display: block; margin-top: 18px;
    font-size: 11px; letter-spacing: 0.08em; color: #a8b0b8;
  }
  @media (max-width: 720px) {
    .meta { display: none; }
    body::before { inset: 10px; }
    .tag { letter-spacing: 0.16em; }
  }
</style>
</head>
<body>
<div class="meta meta-l" aria-hidden="true"><span>Console</span><b>God&#39;s Eye</b></div>
<div class="meta meta-r" aria-hidden="true"><span>Status</span><b>Required</b></div>
<form method="post" action="/api/wall">
  <p class="kicker">Security clearance</p>
  <h1>God&#39;s Eye <span>View</span></h1>
  <p class="tag">No place left behind</p>
  <div class="rule" role="presentation"></div>
  ${notice}
  <input name="pin" type="password" inputmode="numeric" autocomplete="one-time-code"
    placeholder="PIN" aria-label="PIN" required>
  <button type="submit">Freischalten</button>
  <small>Zugang 30 Tage, danach neu eingeben.</small>
</form>
</body>
</html>`;
}

/**
 * Where the built app shell lives inside the function bundle.
 *
 * `vercel.json` lists `dist/index.html` under this function's `includeFiles`, so
 * the deployment ships one copy of the document to the function as well as the
 * static output. The candidates cover the two ways Vercel can place the bundle
 * on disk (`/var/task`, where `dist/` sits next to the code, and after the API
 * entry changed the working directory).
 * @returns {string|null}
 */
function appShellPath() {
  const candidates = [
    process.env.GEV_APP_ROOT
      ? path.join(process.env.GEV_APP_ROOT, 'dist/index.html')
      : null,
    path.join(process.cwd(), 'dist/index.html'),
    path.resolve(process.cwd(), '../../dist/index.html'),
    path.resolve(process.cwd(), '../dist/index.html'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Handle the gate.
 *
 * `mode` is passed by the two entries rather than derived from the path, because
 * a legacy `routes` rewrite makes `req.url` equal to the destination for every
 * document request — `^/$ → /api/wall-shell` arrives as `/api/wall-shell`, so the
 * pathname cannot tell a visitor from the unlock form's own POST.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {'shell' | 'api'} [mode] `shell` serves the gated document, `api` the
 *   JSON status and the PIN POST.
 */
export async function handleWallRequest(req, res, mode = 'api') {
  if (mode === 'shell') return handleShellRequest(req, res);

  if (!wallEnabled())
    return sendJson(res, 200, { status: 'open', wall: 'disabled' });

  const unlocked = requestIsUnlocked(req);

  if (req.method === 'GET')
    return sendJson(res, 200, { status: unlocked ? 'open' : 'locked' });

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }
  if (unlocked) return send(res, 303, { Location: '/' }, pinPageHtml());

  const lockedMs = attemptLockRemainingMs(req);
  if (lockedMs > 0) {
    return sendJson(res, 429, {
      error: 'too_many_attempts',
      retryAfterSeconds: Math.ceil(lockedMs / 1000),
    });
  }

  const submitted = (await readPin(req)).trim();
  const expected = wallPin();
  const a = Buffer.from(submitted, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    await registerFailedAttempt(req);
    return send(res, 401, {}, pinPageHtml('Falsche PIN.'));
  }

  clearFailedAttempts(req);
  const token = createWallToken();
  // `x-forwarded-proto` is set by Vercel's edge and is not attacker-controlled
  // for a request that already reached this function over TLS.
  const secure =
    String(req.headers?.['x-forwarded-proto'] || '')
      .split(',')
      .pop()
      .trim() === 'https'
      ? '; Secure'
      : '';
  return send(
    res,
    303,
    {
      Location: '/',
      'Set-Cookie': `${WALL_COOKIE}=${token.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token.maxAgeSeconds}${secure}`,
    },
    pinPageHtml(),
  );
}

/**
 * `GET` for a document path: the app when unlocked, the PIN form when locked.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleShellRequest(req, res) {
  if (req.method === 'HEAD') {
    res.writeHead(requestIsUnlocked(req) ? 200 : 401, {
      'Cache-Control': 'no-store',
    });
    return res.end();
  }
  if (req.method !== 'GET')
    return sendJson(res, 405, { error: 'method_not_allowed' });

  // No PIN configured → the gate is inert and the document is served normally.
  if (!wallEnabled()) return sendShell(res);

  if (!requestIsUnlocked(req)) return send(res, 401, {}, pinPageHtml());
  return sendShell(res);
}

/**
 * Stream `dist/index.html`. Falls back to a loud 503 instead of redirecting: a
 * redirect would land back here (the catch-all routes to this function), so a
 * missing shell must be an obvious deployment error rather than a loop.
 * @param {import('node:http').ServerResponse} res
 */
function sendShell(res) {
  const shell = appShellPath();
  if (!shell) {
    console.error(
      '[gev-bridge] app shell not found — add dist/index.html to this ' +
        "function's includeFiles in vercel.json.",
    );
    return sendJson(res, 503, { error: 'app_shell_missing' });
  }
  let body;
  try {
    body = fs.readFileSync(shell);
  } catch (err) {
    console.warn('[gev-bridge] app shell unreadable:', err?.message || err);
    return sendJson(res, 503, { error: 'app_shell_unreadable' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
  });
  return res.end(body);
}
