/**
 * Read the vessel snapshot from the Cloudflare relay.
 *
 * The relay (`ais-relay/`, cron every two minutes) owns the single AISStream
 * socket and stores a merged snapshot in KV. With `AIS_RELAY_URL` set, the
 * Vercel bridge must NOT open its own AISStream connection — one socket per
 * key — and reads the relay's HTTP endpoint instead.
 */

export async function relayVesselRows(url) {
  if (!url) return null;
  const controller = new AbortController();
  // The relay carries a whole world frame (megabytes), and the bridge waits up
  // to eight seconds for it; this must not cut the answer off first.
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body?.rows) && body.rows.length ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
