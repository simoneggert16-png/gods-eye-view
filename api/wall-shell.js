/**
 * Vercel entry for the gated document: `GET /` (and any SPA path).
 *
 * `vercel.json` points `^/$`, `^/index.html$` and the catch-all here instead of
 * straight at `/index.html`, so the PIN decides whether the visitor gets the app
 * shell or the unlock form. Static assets (`/assets/*`) stay on the filesystem
 * handler — they are the build output and carry no data; every endpoint that does
 * is gated inside the dispatcher.
 *
 * The shell itself is bundled into this function by `includeFiles`
 * (`dist/index.html`); see `vercel-bridge/wall.js` for the lookup order and for
 * what happens when it is missing.
 */

const { handleWallRequest } = await import('../vercel-bridge/wall.js');

export default async function handler(req, res) {
  try {
    await handleWallRequest(req, res, 'shell');
  } catch (err) {
    console.warn('[gev-bridge] shell gate error:', err?.message || err);
    if (!res.writableEnded && !res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    }
    if (!res.writableEnded) res.end('gateway error');
  }
}
