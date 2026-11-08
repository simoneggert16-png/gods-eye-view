// Data relay for God's Eye View: runs 24/7 on a host Vercel is not (the Contabo
// VPS, or an interim Termux phone), where egress IPs are not shared with
// thousands of other Lambdas and OpenSky/airplanes.live/Windy answer normally.
// Node 18+, no dependencies.
//   RELAY_TOKEN=<token> PORT=8787 WINDY_KEY=<key> node flights-relay.mjs
// Endpoints (all require x-relay-token):
//   /flights  — OpenSky worldwide states, cached 30 s
//   /mil      — airplanes.live military list, cached 60 s
//   /cameras  — webcam list collected by the crawl below (?limit=&countries=)
//   /health   — liveness plus what is cached
// Nothing here ever throws out of the request handler or the crawl tick: the
// phone/VPS box must keep serving the layers it does have when one upstream is
// slow, and systemd restarts alone lose the collected state.
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { redditItems } from './reddit.mjs';

const TOKEN = String(process.env.RELAY_TOKEN || '').replace(/\s+/g, '');
const PORT = Number(process.env.PORT || 8787);
if (!TOKEN) {
  console.error('RELAY_TOKEN is required');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const caches = new Map(); // path -> { at, ttl, body }

async function cached(path, ttlMs, load) {
  const hit = caches.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body;
  const body = await load();
  caches.set(path, { at: Date.now(), body });
  return body;
}

let openskyToken = null;
let openskyTokenAt = 0;

async function openskyAuth() {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return {};
  if (openskyToken && Date.now() - openskyTokenAt < 25 * 60_000)
    return { Authorization: 'Bearer ' + openskyToken };
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret,
  });
  const response = await fetch(
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    },
  );
  const json = await response.json();
  openskyToken = json.access_token || null;
  openskyTokenAt = Date.now();
  return openskyToken ? { Authorization: 'Bearer ' + openskyToken } : {};
}

async function getJson(url, headers = {}, timeoutMs = 20_000) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok)
    throw Object.assign(new Error(`HTTP ${response.status}`), {
      status: response.status,
    });
  return JSON.parse(text);
}

/**
 * Windy webcam crawl.
 *
 * The free Webcams API answers at most 1 000 items per query ("Offset is over
 * API tier limit 1000"), so a single worldwide pass stops at 1 000 of the 69k
 * cameras Windy lists. Partitioning by country gets one 1 000-camera window per
 * country, which is how the list grows past the ~1 500 Swiss cameras and toward
 * global coverage. One request per tick keeps the free tier's rate limits.
 */
const WINDY_FILE = process.env.WINDY_FILE || '/opt/gev-relay/windy.json';
const WINDY_PAGE = 50;
const WINDY_MAX_OFFSET = 1000;
const state = {
  items: {}, // 'windy-<id>' -> {id,name,city,country,lat,lon,snapshotUrl,detailUrl,updatedAt}
  countries: [], // [{code,page,done}]
  cursor: 0,
  at: 0,
  ticks: 0,
  requests: 0,
  failures: 0,
};
let dirty = false;

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(WINDY_FILE, 'utf8'));
    Object.assign(state, saved);
    // `items` is a map keyed by camera id, not a list (a previous format used
    // an array; drop it rather than mis-reading it).
    if (
      !state.items ||
      typeof state.items !== 'object' ||
      Array.isArray(state.items)
    )
      state.items = {};
    if (!Array.isArray(state.countries)) state.countries = [];
  } catch {
    /* first run */
  }
}
let writing = false;
function saveState(force = false) {
  if (!force && !dirty) return;
  dirty = false;
  if (writing) return;
  writing = true;
  // Write-then-rename, so a crash mid-write can never leave a truncated file
  // that the next boot reads as an empty crawl.
  fs.writeFile(WINDY_FILE + '.tmp', JSON.stringify(state), (error) => {
    writing = false;
    if (error) return console.warn('windy state save failed:', error.message);
    try {
      fs.renameSync(WINDY_FILE + '.tmp', WINDY_FILE);
    } catch (renameError) {
      console.warn('windy state rename failed:', renameError.message);
    }
  });
}
loadState();

async function loadCountries() {
  const key = process.env.WINDY_KEY;
  if (!key) return;
  const list = await getJson(
    'https://api.windy.com/webcams/api/v3/countries',
    { 'x-windy-api-key': key },
    15_000,
  );
  const codes = (Array.isArray(list) ? list : [])
    .map((c) => String(c?.code || '').toUpperCase())
    .filter(Boolean)
    .sort();
  if (!codes.length) return;
  // The operator's own region first: a worldwide pass that starts in Albania
  // would take an hour to reach the Swiss cameras the map is watched for.
  const priority = String(process.env.WINDY_PRIORITY || 'CH,LI,DE,AT,IT,FR')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const front = priority.filter((code) => codes.includes(code));
  const ordered = [...front, ...codes.filter((code) => !front.includes(code))];
  // Keep the crawl position of countries already started; append newcomers.
  const known = new Map(state.countries.map((c) => [c.code, c]));
  state.countries = ordered.map(
    (code) => known.get(code) || { code, page: 0, done: false },
  );
  state.cursor = 0;
  dirty = true;
}

function nextCountry() {
  if (!state.countries.length) return null;
  for (let i = 0; i < state.countries.length; i += 1) {
    const entry = state.countries[(state.cursor + i) % state.countries.length];
    if (!entry.done) {
      state.cursor = (state.cursor + i) % state.countries.length;
      return entry;
    }
  }
  // Every country is exhausted: start a second pass so snapshot timestamps and
  // newly published cameras refresh instead of freezing.
  for (const entry of state.countries) {
    entry.done = false;
    entry.page = 0;
  }
  state.cursor = 0;
  return state.countries[0];
}

async function windyTick() {
  const key = process.env.WINDY_KEY;
  if (!key) return;
  try {
    if (!state.countries.length) await loadCountries();
    const entry = nextCountry();
    if (!entry) return;
    const params = new URLSearchParams({
      limit: String(WINDY_PAGE),
      offset: String(entry.page * WINDY_PAGE),
      include: 'location,images,urls',
      lang: 'en',
      countries: entry.code,
    });
    const payload = await getJson(
      'https://api.windy.com/webcams/api/v3/webcams?' + params,
      { 'x-windy-api-key': key },
      15_000,
    );
    state.requests += 1;
    const list = Array.isArray(payload?.webcams) ? payload.webcams : [];
    for (const cam of list) {
      const id = String(cam.webcamId || '');
      const lat = Number(cam?.location?.latitude);
      const lon = Number(cam?.location?.longitude);
      const preview = String(cam?.images?.current?.preview || '');
      if (!id || !preview || !Number.isFinite(lat) || !Number.isFinite(lon))
        continue;
      state.items['windy-' + id] = {
        id: 'windy-' + id,
        name: String(cam.title || id).slice(0, 120),
        city: String(cam?.location?.city || cam?.location?.country || ''),
        country: String(cam?.location?.country_code || entry.code || '')
          .toUpperCase()
          .slice(0, 2),
        provider: 'Windy Webcams',
        lat,
        lon,
        snapshotUrl: preview,
        detailUrl: String(cam?.urls?.detail || ''),
        updatedAt: Date.parse(cam.lastUpdatedOn) || 0,
      };
      dirty = true;
    }
    entry.page += 1;
    if (list.length < WINDY_PAGE || entry.page * WINDY_PAGE > WINDY_MAX_OFFSET)
      entry.done = true;
    state.at = Date.now();
    state.ticks += 1;
  } catch (error) {
    state.failures += 1;
    console.warn(
      'windy tick failed:',
      String(error?.message || error).slice(0, 160),
    );
  } finally {
    // The interval owns the crawl's state, so a tick always ends by saving:
    // progress on disk is never further behind than a single request, and a
    // failed request loses nothing the previous one did not already store.
    saveState();
  }
}

/**
 * The camera list the app is served. The crawl holds far more than a map
 * catalog can carry, so this answers a bounded subset that stays worth looking
 * at: the home countries in full, then the rest dealt out one camera per
 * country at a time so Asia, Africa and South America keep appearing instead of
 * being crowded out by whichever network published most recently.
 *
 *   GET /cameras?limit=6000&home=CH,LI&priority=CH,LI,DE,AT,IT,FR&weight=6
 */
function camerasPayload(query) {
  const items = Object.values(state.items);
  const limit = Math.min(
    20000,
    Math.max(100, Number(query.get('limit')) || 6000),
  );
  if (query.get('full') === '1') return items;
  const codes = (value, fallback) =>
    String(value || fallback)
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
  const home = codes(query.get('home'), 'CH,LI');
  const priority = codes(
    query.get('priority'),
    'CH,LI,DE,AT,IT,FR,ES,GB,US,JP,AU',
  );
  const weight = Math.max(1, Number(query.get('weight')) || 6);
  const byAge = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);

  const groups = new Map();
  for (const item of items) {
    const code = String(item.country || '--').toUpperCase();
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(item);
  }
  for (const list of groups.values()) list.sort(byAge);

  const out = [];
  const taken = new Map();
  const take = (code, count) => {
    const list = groups.get(code);
    if (!list) return 0;
    const from = taken.get(code) || 0;
    const slice = list.slice(from, from + count);
    taken.set(code, from + slice.length);
    out.push(...slice);
    return slice.length;
  };

  // 1. Home countries in full: the operator's own region is never thinned.
  for (const code of home) take(code, limit - out.length);
  // 2. Deal the rest: `weight` cameras from each priority country, then one
  // from every other country, round by round, until the budget is spent.
  const others = [...groups.keys()]
    .filter((code) => !priority.includes(code))
    .sort();
  let round = 0;
  while (out.length < limit && round < 4000) {
    let dealt = 0;
    for (const code of priority) {
      if (out.length >= limit) break;
      dealt += take(code, Math.min(weight, limit - out.length));
    }
    for (const code of others) {
      if (out.length >= limit) break;
      dealt += take(code, 1);
    }
    round += 1;
    if (!dealt) break; // every country is exhausted
  }
  return out;
}

function send(req, res, status, body, type = 'application/json', extra = {}) {
  const payload = Buffer.from(body);
  const headers = {
    'content-type': type,
    'cache-control': 'no-store',
    ...extra,
  };
  const gzip = /(^|,| )gzip/.test(String(req.headers['accept-encoding'] || ''));
  if (gzip && payload.length > 1024) {
    const packed = zlib.gzipSync(payload);
    res.writeHead(status, {
      ...headers,
      'content-encoding': 'gzip',
      'content-length': String(packed.length),
      vary: 'Accept-Encoding',
    });
    return res.end(packed);
  }
  res.writeHead(status, {
    ...headers,
    'content-length': String(payload.length),
  });
  res.end(payload);
}

process.on('uncaughtException', (error) =>
  console.warn('uncaught:', String(error?.message || error).slice(0, 160)),
);
process.on('unhandledRejection', (error) =>
  console.warn('rejection:', String(error?.message || error).slice(0, 160)),
);
process.on('SIGTERM', () => {
  saveState(true);
  process.exit(0);
});
process.on('SIGINT', () => {
  saveState(true);
  process.exit(0);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (String(req.headers['x-relay-token'] || '').replace(/\s+/g, '') !== TOKEN)
    return send(req, res, 401, '{"error":"unauthorized"}');
  try {
    if (url.pathname === '/reddit') {
      const items = await redditItems();
      return send(req, res, 200, JSON.stringify({ items, at: Date.now() }));
    }
    if (url.pathname === '/cameras') {
      const items = camerasPayload(url.searchParams);
      return send(
        req,
        res,
        200,
        JSON.stringify({
          items,
          total: Object.keys(state.items).length,
          requests: state.requests,
          failures: state.failures,
          at: state.at,
        }),
      );
    }
    let body;
    if (url.pathname === '/flights') {
      body = await cached('/flights', 30_000, async () =>
        getJson(
          'https://opensky-network.org/api/states/all',
          await openskyAuth(),
        ),
      );
    } else if (url.pathname === '/mil') {
      body = await cached('/mil', 60_000, () =>
        getJson('https://api.airplanes.live/v2/mil', {
          Referer: 'https://airplanes.live/',
        }),
      );
    } else if (url.pathname === '/health') {
      body = {
        ok: true,
        cached: [...caches.keys()],
        cameras: Object.keys(state.items).length,
        countries: state.countries.length,
        countriesDone: state.countries.filter((c) => c.done).length,
        requests: state.requests,
        failures: state.failures,
        at: state.at,
      };
    } else {
      return send(req, res, 404, '{"error":"not_found"}');
    }
    return send(req, res, 200, JSON.stringify(body));
  } catch (error) {
    const status = error?.status === 429 ? 429 : 502;
    return send(
      req,
      res,
      status,
      JSON.stringify({
        error: 'relay_failed',
        detail: String(error?.message || error).slice(0, 120),
      }),
    );
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `flight relay on :${PORT} (${Object.keys(state.items).length} cameras cached)`,
  );
});
setTimeout(windyTick, 3000);
setInterval(windyTick, Number(process.env.WINDY_TICK_MS || 10_000));
setInterval(() => saveState(), 60_000);
