/**
 * Vercel entry for the PIN gate's API surface: `GET|POST /api/wall`.
 *
 * `GET` reports `{status:"open"|"locked"}`; `POST` with `pin=…` (form-encoded or
 * JSON) validates the PIN and sets the signed `gev_wall` cookie. The document
 * half of the gate — the app shell or the PIN form — lives in
 * `api/wall-shell.js`, because a legacy `routes` rewrite makes `req.url` equal to
 * the destination and the path therefore cannot tell the two apart.
 *
 * All logic, including the brute-force brake and the cookie format, is in
 * `vercel-bridge/wall.js`.
 */

const { handleWallRequest } = await import('../vercel-bridge/wall.js');

export default async function handler(req, res) {
  try {
    await handleWallRequest(req, res, 'api');
  } catch (err) {
    console.warn('[gev-bridge] wall error:', err?.message || err);
    if (!res.writableEnded && !res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'wall' }));
  }
}
