/**
 * OpenSky egress shim for the Vercel deployment.
 *
 * The problem this solves
 * -----------------------
 * `server/providers/aircraft/opensky.js` fetches the worldwide snapshot from
 * `https://opensky-network.org/api/states/all?extended=1` with a hard
 * `OPENSKY_ATTEMPT_TIMEOUT_MS = 10_000` per attempt, one retry, and an OAuth
 * token fetch on the same 10 s budget. From a local machine OpenSky answers in
 * 0.13–0.31 s. From Vercel's egress (tested in fra1) the TCP connection never
 * completes at all, so every `/api/flights` request burned
 * ~30 s (token 10 s + 2 snapshot attempts × 10 s) before it gave up and served
 * the regional adsb.lol fallback. With `maxDuration: 60` that is half the
 * function budget spent proving a known-unreachable host is unreachable, on
 * every 30 s poll, and it left the layer feeling dead.
 *
 * Upstream already contains the right answer for a host it cannot reach:
 * `serveAdsbLolPointFallback()` answers from `api.adsb.lol` around the camera
 * anchor the client always sends (`/api/flights?lat=…&lon=…`, 250 nm radius),
 * and it labels the response honestly with `X-Flight-Source: adsb.lol`. The
 * only thing missing is a way to reach that branch quickly. Upstream exposes no
 * env knob for it and this bridge never edits upstream files, so the timeout is
 * applied one level down instead: a `globalThis.fetch` wrapper scoped to the two
 * OpenSky hostnames.
 *
 * What the shim does
 * ------------------
 *  - Probe mode (default): OpenSky requests get a short deadline
 *    (`OPENSKY_EGRESS_PROBE_MS`, 6 s — a healthy OpenSky answers in ~1.5 s, so
 *    this never truncates a working call). A successful probe marks the host
 *    healthy for `OPENSKY_EGRESS_HEALTHY_MS` (15 min), during which the shim is
 *    completely inert and upstream's own timeouts govern.
 *  - Circuit breaker: a failed probe marks the host unreachable for
 *    `OPENSKY_EGRESS_BREAK_MS` (10 min). While open, OpenSky requests throw
 *    immediately, so upstream's retry throws immediately too and the adsb.lol
 *    fallback answers in ~1–2 s instead of ~30 s. The breaker expires on its
 *    own, so a region where OpenSky does work recovers without a redeploy.
 *  - Bridge mode: if `OPENSKY_BRIDGE_URL` is set, the snapshot request is
 *    rewritten to that URL instead (with `Authorization: Bearer
 *    $OPENSKY_BRIDGE_TOKEN` when set). This is the hook for a relay running on
 *    a network that *can* reach OpenSky — e.g. a Cloudflare Worker, whose
 *    egress is not blocked. Setting it restores worldwide coverage with no code
 *    change; the breaker and probe are bypassed entirely in this mode.
 *  - Kill switch: `OPENSKY_EGRESS=off` makes the shim throw immediately and
 *    permanently, i.e. always use the adsb.lol fallback and never spend time on
 *    OpenSky.
 *
 * Everything else that goes through `fetch` — adsb.lol, TomTom, FIRMS, Gemini,
 * AISStream — is passed to the original implementation untouched.
 */

/** Hostnames the shim governs. Everything else is forwarded verbatim. */
const OPENSKY_HOSTS = Object.freeze([
  'opensky-network.org',
  'auth.opensky-network.org',
]);

/** Path prefix of the endpoint a bridge can serve (the worldwide snapshot). */
const STATES_PATH = '/api/states/all';

/** @type {number} Probe deadline for an OpenSky request (ms). */
const DEFAULT_PROBE_MS = 6_000;
/** @type {number} How long a success keeps the shim inert (ms). */
const DEFAULT_HEALTHY_MS = 900_000;
/** @type {number} How long a failure keeps the breaker open (ms). */
const DEFAULT_BREAK_MS = 600_000;

function intFromEnv(env, key, fallback) {
  const raw = Number(env?.[key]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/**
 * Extract the hostname from any `fetch()` first argument.
 * @param {unknown} input
 * @returns {string|null}
 */
function hostOf(input) {
  try {
    if (typeof input === 'string') return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === 'object' && 'url' in input) {
      return new URL(String(input.url)).hostname;
    }
  } catch {
    /* not a URL we can parse — treat as "not OpenSky" */
  }
  return null;
}

/**
 * Install the shim. Idempotent per process; call once from the function entry.
 * @param {{env?: NodeJS.ProcessEnv, now?: () => number, fetchImpl?: Function}} [options]
 * @returns {() => {healthy: boolean, brokenUntil: number, probes: number, failures: number, mode: string}}
 *   A reader for the current breaker state (used by tests and diagnostics).
 */
export function installOpenSkyEgressShim(options = {}) {
  const env = options.env || process.env;
  const now = options.now || (() => Date.now());

  if (globalThis.__gevOpenSkyEgressState) {
    return globalThis.__gevOpenSkyEgressState.read;
  }

  const realFetch = options.fetchImpl || globalThis.fetch;
  const state = {
    mode: env.OPENSKY_BRIDGE_URL
      ? 'bridge'
      : env.OPENSKY_EGRESS === 'off'
        ? 'off'
        : 'probe',
    healthyUntil: 0,
    brokenUntil: 0,
    probes: 0,
    failures: 0,
  };

  const probeMs = intFromEnv(env, 'OPENSKY_EGRESS_PROBE_MS', DEFAULT_PROBE_MS);
  const healthyMs = intFromEnv(
    env,
    'OPENSKY_EGRESS_HEALTHY_MS',
    DEFAULT_HEALTHY_MS,
  );
  const breakMs = intFromEnv(env, 'OPENSKY_EGRESS_BREAK_MS', DEFAULT_BREAK_MS);

  /**
   * Rewrite a snapshot request onto the configured relay.
   * @param {string} url
   * @returns {string}
   */
  function bridgeUrlFor(url) {
    const base = String(env.OPENSKY_BRIDGE_URL);
    const target = new URL(base);
    const incoming = new URL(url);
    // The relay owns the upstream call; only the query is caller-specific and
    // worth forwarding (e.g. `extended=1`). A bridge that ignores it is fine.
    if (incoming.pathname.startsWith(STATES_PATH) && incoming.search) {
      target.search = incoming.search;
    }
    return target.toString();
  }

  globalThis.fetch = async function gevOpenSkyFetch(input, init) {
    const host = hostOf(input);
    if (!host || !OPENSKY_HOSTS.includes(host)) {
      return realFetch(input, init);
    }

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : String(input?.url);

    // --- Bridge mode: hand the call to a network that can reach OpenSky. ---
    if (state.mode === 'bridge' && host === 'opensky-network.org') {
      const headers = new Headers(
        init?.headers || (typeof input === 'object' && input?.headers) || {},
      );
      if (env.OPENSKY_BRIDGE_TOKEN) {
        headers.set('Authorization', `Bearer ${env.OPENSKY_BRIDGE_TOKEN}`);
      }
      return realFetch(bridgeUrlFor(url), { ...init, headers });
    }

    // --- Kill switch: never touch OpenSky, always take the fallback. ---
    if (state.mode === 'off') {
      throw Object.assign(
        new Error('OpenSky egress disabled on this platform'),
        {
          code: 'EGRESSDISABLED',
        },
      );
    }

    const at = now();

    // Recently proven reachable: stay completely out of the way.
    if (at < state.healthyUntil) return realFetch(input, init);

    // Breaker open: fail now so upstream falls back immediately.
    if (at < state.brokenUntil) {
      throw Object.assign(
        new Error(
          `OpenSky unreachable from this platform (circuit open for another ${Math.ceil((state.brokenUntil - at) / 1000)}s)`,
        ),
        { code: 'EGRESSBROKEN' },
      );
    }

    // --- Probe: short deadline, then decide healthy vs. broken. ---
    state.probes += 1;
    const callerSignal = init?.signal || undefined;
    const timeoutSignal = AbortSignal.timeout(probeMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await realFetch(input, { ...init, signal });
      state.healthyUntil = now() + healthyMs;
      state.brokenUntil = 0;
      return response;
    } catch (error) {
      state.failures += 1;
      // A caller-initiated abort is not evidence about OpenSky's reachability.
      const callerAborted = callerSignal?.aborted && !timeoutSignal.aborted;
      if (!callerAborted) {
        state.brokenUntil = now() + breakMs;
        console.warn(
          `[gev-bridge] OpenSky probe failed (${error?.cause?.code || error?.code || error?.message}); ` +
            `breaker open for ${Math.round(breakMs / 1000)}s, serving the adsb.lol regional fallback instead.`,
        );
      }
      throw error;
    }
  };

  const read = () => ({
    healthy: now() < state.healthyUntil,
    brokenUntil: state.brokenUntil,
    probes: state.probes,
    failures: state.failures,
    mode: state.mode,
  });
  globalThis.__gevOpenSkyEgressState = { state, read };
  return read;
}

/** Current breaker state, or null when the shim is not installed. */
export function openSkyEgressState() {
  return globalThis.__gevOpenSkyEgressState?.read() || null;
}
