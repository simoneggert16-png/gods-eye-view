/**
 * AISStream warm-up for the Vercel deployment.
 *
 * The problem this solves
 * -----------------------
 * `server/providers/vessels/ais-live.js` is built for a long-lived process: it
 * opens ONE websocket to `wss://stream.aisstream.io/v0/stream`, ingests
 * envelopes into an in-memory store (`ais-store.js`) and answers
 * `GET /api/vessels` from whatever has accumulated. Two things break that model
 * on a serverless platform:
 *
 *  1. Transport — `ws` is a devDependency loaded lazily through
 *     `createRequire`, so Node File Tracing never sees the import and the
 *     module is missing from the function bundle. `aisWebSocketImpl()` then
 *     returns null and the feed reports `status:"unsupported"` forever. Fixed
 *     by listing `node_modules/ws/**` in `vercel.json` → `includeFiles`.
 *  2. Lifetime — a Vercel function starts empty and is frozen between
 *     requests, so the very first `/api/vessels` call after a cold start would
 *     answer with `rows: []` even though the socket connects fine. The client
 *     polls on an interval, so it would eventually fill, but the first paint of
 *     the vessel layer would be an empty ocean and the status banner would read
 *     as "reconnecting".
 *
 * What this module does
 * ---------------------
 * It never opens a socket itself — upstream's adapter owns the socket and the
 * generation namespace, and duplicating that would break AISStream's
 * one-connection-per-key rule. Instead the dispatcher runs the upstream handler
 * once against a throwaway response (which is what triggers
 * `ensureAisStreamConnection()`), then waits here until the shared store
 * actually holds vessels, and only then dispatches the real request. Waiting
 * inside the request is the key part: while a request is in flight the instance
 * is running, so the socket's messages are processed.
 *
 * Guard rails:
 *  - `GEV_AIS_WARMUP_MS` (default 3500, 0 disables) bounds the wait. The vessel
 *    layer aborts its own fetch after 10 s (`AbortSignal.timeout(10_000)` in
 *    `src/layers/vessels/ingestion.js`), and the upstream handler is entered
 *    twice per request, so the budget has to stay under that deadline.
 *  - `GEV_AIS_WARMUP_ROWS` (default 1500) ends the wait early once the snapshot
 *    is worth rendering. It is deliberately not a token count: the store caps at
 *    50 000 vessels and the client asks for 12 000 per poll
 *    (`DEFAULT_RENDER_ROWS`), so a first paint of a few hundred rows would leave
 *    the layer looking dead even though the socket is streaming fine.
 *  - A warm-up that ends empty opens a cooldown (`GEV_AIS_WARMUP_RETRY_MS`,
 *    default 60 s) during which requests are answered immediately from the
 *    store. Without it a rejected key or a blocked egress would tax every poll
 *    with the full wait.
 */

import { aisStreamRows } from '../server/providers/vessels/ais-store.js';

/** @type {number} Longest wait for a first snapshot (ms). */
const DEFAULT_WARMUP_MS = 3_500;
/**
 * Row count that ends the wait early.
 *
 * Measured 2026-11-03: a cold instance ingests only ~60-120 distinct
 * vessels/second, so no bounded wait can reach a warm store's ~15 000 — five
 * seconds of waiting bought a few hundred rows. The first paint therefore takes
 * a quick frame and stops blocking the client; the layer's 60 s refresh interval
 * is what lets the instance's store keep growing (roughly 4 000 vessels per
 * minute, and once the store is warm every poll answers in well under a second).
 */
const DEFAULT_MIN_ROWS = 1_500;
/** @type {number} Poll interval while waiting (ms). */
const POLL_MS = 400;
/** @type {number} Cooldown after an empty warm-up (ms). */
const DEFAULT_RETRY_MS = 60_000;

function intFromEnv(key, fallback) {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/** Epoch-ms before which no further warm-up is attempted. */
let cooldownUntil = 0;

/**
 * Minimal `ServerResponse` stand-in.
 *
 * Used only for the throwaway first pass over the upstream handler, whose
 * `/api/vessels` branch uses `setHeader`, `statusCode` and `end` (no streaming,
 * no body read). Anything written here is discarded — the real response is
 * produced by the second pass.
 * @returns {import('node:http').ServerResponse}
 */
export function createCapturingResponse() {
  const headers = new Map();
  /** @type {any} */
  const res = {
    statusCode: 200,
    statusMessage: '',
    headersSent: false,
    writableEnded: false,
    finished: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return res;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    getHeaders() {
      return Object.fromEntries(headers);
    },
    removeHeader(name) {
      headers.delete(String(name).toLowerCase());
    },
    writeHead(status, reasonOrHeaders, maybeHeaders) {
      res.statusCode = status;
      const candidate =
        typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
      if (candidate) {
        for (const [key, value] of Object.entries(candidate)) {
          headers.set(String(key).toLowerCase(), value);
        }
      }
      res.headersSent = true;
      return res;
    },
    write() {
      return true;
    },
    end() {
      res.writableEnded = true;
      res.finished = true;
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    emit() {
      return false;
    },
    flushHeaders() {},
  };
  return res;
}

/**
 * Wait until the shared AIS store holds at least `minRows` vessels.
 *
 * Resolves early on success, on deadline, and while the cooldown is open. The
 * socket itself is upstream's; this only observes the store it fills.
 * @param {{maxWaitMs?: number, minRows?: number}} [options]
 * @returns {Promise<{rows: number, waitedMs: number, timedOut: boolean}>}
 */
export async function waitForVesselRows(options = {}) {
  const maxWaitMs =
    options.maxWaitMs ?? intFromEnv('GEV_AIS_WARMUP_MS', DEFAULT_WARMUP_MS);
  const minRows =
    options.minRows ?? intFromEnv('GEV_AIS_WARMUP_ROWS', DEFAULT_MIN_ROWS);

  const started = Date.now();
  // `aisStreamRows` sorts the whole store on every call, so the wait asks for
  // exactly the number it needs to compare against instead of the full frame.
  const count = () => {
    try {
      return aisStreamRows(minRows).length;
    } catch {
      return 0;
    }
  };

  if (maxWaitMs <= 0) return { rows: count(), waitedMs: 0, timedOut: false };
  if (Date.now() < cooldownUntil) {
    return { rows: count(), waitedMs: 0, timedOut: false };
  }

  let rows = count();
  while (rows < minRows && Date.now() - started < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    rows = count();
  }

  const waitedMs = Date.now() - started;
  if (rows === 0) {
    cooldownUntil =
      Date.now() + intFromEnv('GEV_AIS_WARMUP_RETRY_MS', DEFAULT_RETRY_MS);
    console.warn(
      `[gev-bridge] AISStream produced no vessels within ${waitedMs}ms; ` +
        'answering from the empty store and cooling down before the next warm-up.',
    );
  }
  return { rows, waitedMs, timedOut: rows < minRows };
}

/** True while an empty warm-up is suppressing further waits. */
export function aisWarmupCoolingDown() {
  return Date.now() < cooldownUntil;
}
