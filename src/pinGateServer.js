/**
 * Server-side PIN Gatekeeper for God's Eye View.
 *
 * Intercepts AI & cost-bearing endpoints when GEV_ACCESS_PIN is configured in
 * the server environment. Rejects unauthenticated requests with 401 before
 * upstream keys (Gemini, Ollama, OpenAI, Z.AI) are touched.
 */

export function pinGateProxy() {
  const pin = String(process.env.GEV_ACCESS_PIN || '').trim();
  const failedAttempts = new Map(); // ip -> { count, lockedUntil }
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

  function isLocked(ip) {
    const record = failedAttempts.get(ip);
    if (!record) return false;
    if (Date.now() < record.lockedUntil) return true;
    failedAttempts.delete(ip);
    return false;
  }

  function recordFail(ip) {
    const rec = failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = Date.now() + LOCKOUT_MS;
    failedAttempts.set(ip, rec);
    return rec;
  }

  function install(middlewares) {
    // 1. Status endpoint: whether PIN is required and if caller is authenticated
    middlewares.use('/api/pin/status', (req, res) => {
      const isAuth = !pin || (req.headers.cookie || '').includes('gev_auth=1');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ required: !!pin, authenticated: isAuth }));
    });

    // 2. Verification endpoint
    middlewares.use('/api/pin/verify', async (req, res) => {
      const send = (status, payload, headers = {}) => {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...headers,
        });
        res.end(JSON.stringify(payload));
      };

      if (req.method !== 'POST') return send(405, { error: 'Method Not Allowed' });
      if (!pin) return send(200, { ok: true, message: 'No PIN required' });

      const ip = req.socket?.remoteAddress || 'local';
      if (isLocked(ip)) {
        return send(429, { ok: false, error: 'Zu viele Fehlversuche. IP für 15 Min gesperrt.' });
      }

      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const { pin: inputPin } = JSON.parse(body || '{}');
        if (inputPin === pin) {
          failedAttempts.delete(ip);
          return send(200, { ok: true }, {
            'Set-Cookie': 'gev_auth=1; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000',
          });
        }
        const rec = recordFail(ip);
        const rem = Math.max(0, MAX_ATTEMPTS - rec.count);
        return send(401, {
          ok: false,
          error: rem > 0 ? `Falscher PIN! (${rem} Versuche übrig)` : 'Zu viele Fehlversuche. IP gesperrt.',
        });
      } catch {
        return send(400, { ok: false, error: 'Ungültige Anfrage' });
      }
    });

    // 3. Protection middleware for AI endpoints
    middlewares.use((req, res, next) => {
      if (!pin) return next();
      const protectedPrefixes = ['/api/gemini', '/api/ollama', '/api/zai', '/api/openai'];
      const pathname = (req.url || '').split('?')[0];
      if (protectedPrefixes.some((p) => pathname.startsWith(p))) {
        const hasCookie = (req.headers.cookie || '').includes('gev_auth=1');
        const hasHeader = req.headers['x-gev-pin'] === pin;
        if (!hasCookie && !hasHeader) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'PIN required. Access denied.', pinRequired: true }));
        }
      }
      next();
    });
  }

  return {
    name: 'gev-pin-gate-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}
