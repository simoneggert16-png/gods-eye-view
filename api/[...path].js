/**
 * Vercel entry point for every `/api/*` route of God's Eye View.
 *
 * Upstream keeps all key-brokering endpoints in Vite server plugins, so this
 * catch-all hands the raw Node request/response to the bridge, which replays
 * those plugins' middleware. See `vercel-bridge/dispatcher.js` for the details
 * and for what is deliberately excluded.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Point `process.cwd()` at writable storage before any provider is imported.
 *
 * Every disk-cached provider resolves its cache as
 * `path.join(process.cwd(), '.gev-cache', …)` — TomTom tiles, FIRMS, Celestrak,
 * Overpass, terrain heights, military installations, adsbdb. On Vercel the
 * deployment directory is read-only, so those writes would throw. `/tmp` is
 * writable (and warm across invocations), which keeps the caches working as
 * designed for the lifetime of the instance.
 *
 * This must happen before the dispatcher import resolves the plugin factories,
 * and it is safe for data reads: `defaultSourceRoot` is derived from
 * `import.meta.url`, not from cwd, so `config/*.json` still resolves inside the
 * deployment.
 */
const writableRoot = (() => {
  try {
    mkdirSync('/tmp', { recursive: true });
    return '/tmp';
  } catch {
    return os.tmpdir();
  }
})();

/**
 * Remember the read-only deployment directory before leaving it.
 *
 * Anything that needs a file from the bundle itself — the app shell behind the
 * PIN gate, for instance — cannot use `process.cwd()` after the `chdir` below,
 * so the origin is published once here.
 */
process.env.GEV_APP_ROOT = process.cwd();

try {
  process.chdir(writableRoot);
} catch {
  /* If chdir is unavailable the caches simply stay cold; reads still work. */
}

try {
  mkdirSync(path.join(writableRoot, '.gev-cache'), { recursive: true });
} catch {
  /* Providers treat an unwritable cache as a miss, not a fatal error. */
}

/**
 * Adapt OpenSky's egress before any provider module is loaded.
 *
 * `opensky-network.org` is unreachable from Vercel's egress even though it
 * answers in ~0.2 s from a developer machine, and upstream's hardcoded 10 s
 * per-attempt budget (× 2 attempts + the OAuth token fetch) made every
 * `/api/flights` call take ~30 s before falling back to the regional adsb.lol
 * snapshot. The shim probes with a short deadline and opens a circuit breaker on
 * failure, so the fallback upstream already implements answers in ~1–2 s, and it
 * hands the call to `OPENSKY_BRIDGE_URL` when a relay on a network that *can*
 * reach OpenSky is configured. Details and env knobs: `opensky-egress.js`.
 */
const { installOpenSkyEgressShim } =
  await import('../vercel-bridge/opensky-egress.js');
installOpenSkyEgressShim();

const { handleApiRequest } = await import('../vercel-bridge/dispatcher.js');

export default async function handler(req, res) {
  try {
    await handleApiRequest(req, res);
  } catch (err) {
    console.warn('[gev-bridge] unhandled error:', err?.message || err);
    if (!res.writableEnded && !res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'proxy' }));
  }
}
