/**
 * Global weather products for `GET /api/weather/*`.
 *
 * Why this exists
 * ---------------
 * Upstream serves every weather product from NOAA nowCOAST: CONUS radar
 * (`conus_base_reflectivity_mosaic`), CONUS lightning density and GOES
 * East/West infrared. All of it is the Americas — a globe zoomed to Europe or
 * Asia shows an empty weather layer.
 *
 * NASA GIBS publishes the same kind of imagery as a WMS in EPSG:4326, which is
 * exactly the tiling scheme the weather layer validates (`tilingScheme:
 * 'geographic'`, 2:1 level zero, `maxLevel: 6`), so the bridge can answer the
 * manifest / image / tile routes from it without touching the client:
 *
 *  - `radar`            → IMERG_Precipitation_Rate_30min (global, 30 min steps,
 *                         a few hours behind real time)
 *  - `clouds`           → MODIS_Terra_CorrectedReflectance_TrueColor (global
 *                         daily true-colour mosaic; clouds are the bright parts
 *                         the layer's brightness filter already keys on)
 *  - `clouds-regional`  → same global true-colour image
 *
 * `lightning` deliberately stays on nowCOAST: there is no keyless global
 * lightning-density raster, and a US-only layer that says so is better than a
 * world map that invents strikes.
 *
 * Contract notes: the client validates `times` as ISO strings with milliseconds,
 * strictly increasing, `latest === times.at(-1)`, `tileSize === 256`,
 * `maxLevel === 6`, `tilingScheme === 'geographic'` (`src/layers/weather/
 * source.js`). Tiles are Cesium geographic tiles (y from the south); WMS 1.3.0
 * EPSG:4326 takes BBOX as minLat,minLon,maxLat,maxLon.
 */

const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

const PRODUCTS = {
  radar: {
    layer: 'IMERG_Precipitation_Rate_30min',
    format: 'image/png',
    title: 'Global precipitation rate',
    coverage:
      'Global · NASA GPM IMERG · 30-minute steps, roughly 6 hours delayed',
    description:
      'IMERG precipitation rate on a 0.1° grid, global. Not radar reflectivity and not a forecast; latency is typically 4-6 hours.',
    attribution: 'NASA GPM IMERG · NASA GIBS',
    display: {
      source: 'NASA GIBS · IMERG',
      credit: 'NASA GPM IMERG · NASA GIBS',
      coverage: 'Global · 30-minute steps',
      info: 'IMERG precipitation rate on a 0.1° grid, global; typically 4-6 hours delayed. Not radar reflectivity and not a forecast.',
    },
    imageSize: { width: 4096, height: 2048 },
    stepMs: 30 * 60 * 1000,
    frames: 6,
    lagMs: 6 * 60 * 60 * 1000,
    ttlMs: 2 * 60 * 1000,
  },
  clouds: {
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    format: 'image/jpeg',
    title: 'Global satellite true colour',
    coverage: 'Global · NASA MODIS Terra · daily mosaic',
    description:
      'Corrected-reflectance true-colour mosaic (clouds, land and sea). One daytime pass per day; not a cloud-only mask.',
    attribution: 'NASA MODIS · NASA GIBS',
    display: {
      source: 'NASA GIBS · MODIS',
      credit: 'NASA MODIS Terra · NASA GIBS',
      coverage: 'Global · daily mosaic',
      info: 'Corrected-reflectance true colour (clouds, land and sea), one daytime pass per day. Not a cloud-only mask.',
    },
    imageSize: { width: 2048, height: 1024 },
    stepMs: 24 * 60 * 60 * 1000,
    frames: 6,
    lagMs: 24 * 60 * 60 * 1000,
    ttlMs: 10 * 60 * 1000,
  },
  'clouds-regional': {
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    format: 'image/jpeg',
    title: 'Global satellite true colour',
    coverage: 'Global · NASA MODIS Terra · daily mosaic',
    description:
      'Corrected-reflectance true-colour mosaic (clouds, land and sea). One daytime pass per day; not a cloud-only mask.',
    attribution: 'NASA MODIS · NASA GIBS',
    display: {
      source: 'NASA GIBS · MODIS',
      credit: 'NASA MODIS Terra · NASA GIBS',
      coverage: 'Global · daily mosaic',
      info: 'Corrected-reflectance true colour (clouds, land and sea), one daytime pass per day. Not a cloud-only mask.',
    },
    imageSize: { width: 4096, height: 2048 },
    stepMs: 24 * 60 * 60 * 1000,
    frames: 6,
    lagMs: 24 * 60 * 60 * 1000,
    ttlMs: 10 * 60 * 1000,
  },
};

/** True for the products this module owns. */
export function isGlobalWeatherProduct(product) {
  return Object.hasOwn(PRODUCTS, product);
}

/** Frames for one product: ISO labels ending at `now - lag`, oldest first. */
function frameTimes(spec, nowMs = Date.now()) {
  const times = [];
  const end = nowMs - spec.lagMs;
  for (let i = spec.frames - 1; i >= 0; i -= 1)
    times.push(new Date(end - i * spec.stepMs).toISOString());
  return times;
}

function manifestFor(product) {
  const spec = PRODUCTS[product];
  const times = frameTimes(spec);
  const latest = times.at(-1);
  const encoded = encodeURIComponent(latest);
  return {
    schemaVersion: 1,
    product,
    title: spec.title,
    coverage: spec.coverage,
    description: spec.description,
    source: 'NASA GIBS',
    attribution: spec.attribution,
    display: { ...spec.display },
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    times,
    latest,
    time: latest,
    observedAt: latest,
    fetchedAt: new Date().toISOString(),
    stale: false,
    unavailable: false,
    reason: null,
    tileSize: 256,
    maxLevel: 6,
    tilingScheme: 'geographic',
    tileTemplate: `/api/weather/tile?product=${product}&time=${encoded}&z={z}&x={x}&y={y}`,
    imageUrl: `/api/weather/image?product=${product}&time=${encoded}`,
    imageSize: { ...spec.imageSize },
  };
}

/** @type {Map<string, {at: number, type: string, bytes: Buffer}>} */
const cache = new Map();
const CACHE_MAX = 600;
/** Last working GIBS slot per product, so a lagging product is resolved once. */
const resolvedSlots = new Map();

function clampBbox(west, south, east, north) {
  return {
    west: Math.max(-180, west),
    south: Math.max(-90, south),
    east: Math.min(180, east),
    north: Math.min(90, north),
  };
}

/** Cesium geographic tile (y from the south) → degrees. */
function tileBbox(z, x, y) {
  const tilesX = 2 ** (z + 1);
  const tilesY = 2 ** z;
  const lonW = -180 + (x * 360) / tilesX;
  const latS = -90 + (y * 180) / tilesY;
  return clampBbox(lonW, latS, lonW + 360 / tilesX, latS + 180 / tilesY);
}

async function fetchGibs(spec, time, bbox, width, height) {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const base =
    `${GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
    `&LAYERS=${encodeURIComponent(spec.layer)}&STYLES=` +
    `&CRS=EPSG:4326&BBOX=${box}&WIDTH=${width}&HEIGHT=${height}` +
    `&FORMAT=${encodeURIComponent(spec.format)}`;
  const withTime = time ? `&TIME=${encodeURIComponent(time)}` : '';
  // A GetMap without TIME asks GIBS for "latest" and can hang for tens of
  // seconds (measured 2026-11-03: no response within 30 s), so the fallback is
  // deliberately absent — one bounded attempt, then a fast 502 the client can
  // retry on its next frame. Eight seconds keeps the whole request inside the
  // weather layer's patience.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('gibs deadline')),
    6_000,
  );
  let response;
  try {
    response = await fetch(`${base}${withTime}`, {
      headers: {
        Accept: 'image/png,image/jpeg',
        'User-Agent': 'gods-eye-view-weather/1.0 (NASA GIBS)',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`GIBS HTTP ${response.status}`);
  const type = response.headers.get('content-type') || spec.format;
  if (!type.startsWith('image/')) throw new Error('GIBS returned a non-image');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) throw new Error('GIBS returned an empty image');
  return { type, bytes };
}

/**
 * Answer a global weather route. Returns false when the request is not one of
 * the products this module owns, so the caller falls through to upstream.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @param {string} originalUrl
 * @returns {Promise<boolean>}
 */
export async function handleGlobalWeather(req, res, pathname, originalUrl) {
  if (process.env.GEV_WEATHER_GLOBAL === 'off') return false;
  if (req.method !== 'GET') return false;
  if (!pathname.startsWith('/api/weather/')) return false;
  const route = pathname.slice('/api/weather'.length);
  if (!['/manifest', '/tile', '/image'].includes(route)) return false;
  let url;
  try {
    url = new URL(originalUrl, 'http://localhost');
  } catch {
    return false;
  }
  const product = url.searchParams.get('product');
  if (!isGlobalWeatherProduct(product)) return false;
  const spec = PRODUCTS[product];

  if (route === '/manifest') {
    const payload = Buffer.from(JSON.stringify(manifestFor(product)));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': String(payload.length),
    });
    res.end(payload);
    return true;
  }

  const time = url.searchParams.get('time') || '';
  if (!Number.isFinite(Date.parse(time))) {
    const payload = Buffer.from(
      JSON.stringify({ error: 'invalid_weather_query' }),
    );
    res.writeHead(400, {
      'Content-Type': 'application/json',
      'Content-Length': String(payload.length),
    });
    res.end(payload);
    return true;
  }

  let box;
  let width;
  let height;
  if (route === '/tile') {
    const z = Number(url.searchParams.get('z'));
    const x = Number(url.searchParams.get('x'));
    const y = Number(url.searchParams.get('y'));
    const size = Number(url.searchParams.get('size') || 256);
    if (
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 0 ||
      z > 6 ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** (z + 1) ||
      y >= 2 ** z ||
      ![256, 512, 1024].includes(size)
    ) {
      const payload = Buffer.from(
        JSON.stringify({ error: 'invalid_weather_query' }),
      );
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
      });
      res.end(payload);
      return true;
    }
    box = tileBbox(z, x, y);
    width = size;
    height = size;
  } else {
    const bboxRaw = url.searchParams.get('bbox');
    if (bboxRaw) {
      const edges = bboxRaw.split(',').map(Number);
      if (
        edges.length !== 4 ||
        !edges.every(Number.isFinite) ||
        edges[0] >= edges[2] ||
        edges[1] >= edges[3]
      ) {
        const payload = Buffer.from(
          JSON.stringify({ error: 'invalid_weather_query' }),
        );
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'Content-Length': String(payload.length),
        });
        res.end(payload);
        return true;
      }
      box = clampBbox(edges[0], edges[1], edges[2], edges[3]);
    } else {
      box = { west: -180, south: -90, east: 180, north: 90 };
    }
    const sizeRaw = url.searchParams.get('size');
    const match = /^(\d{2,5})x(\d{2,5})$/.exec(sizeRaw || '');
    const fallback = spec.imageSize;
    width = match ? Number(match[1]) : fallback.width;
    height = match ? Number(match[2]) : fallback.height;
    if (width > 4096 || height > 2048 || width < 16 || height < 16) {
      width = fallback.width;
      height = fallback.height;
    }
  }

  const key = `${spec.layer}|${time}|${box.west},${box.south},${box.east},${box.north}|${width}x${height}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < spec.ttlMs) {
    res.writeHead(200, {
      'Content-Type': hit.type,
      'Cache-Control': 'public, max-age=60',
      'Content-Length': String(hit.bytes.length),
    });
    res.end(hit.bytes);
    return true;
  }

  // GIBS answers 400 for a TIME that has no product frame yet — IMERG lags
  // several hours and MODIS publishes daily, so the newest advertised frame is
  // routinely unavailable. Walk back whole steps until a frame answers and
  // remember the working slot, so later tiles go straight to it.
  // GIBS accepts exactly `YYYY-MM-DD` or `YYYY-MM-DDThh:mm:ssZ` — a millisecond
  // fraction is rejected with 400 InvalidParameterValue (TIME).
  const slotLabel = (ms) =>
    spec.stepMs >= 86_400_000
      ? new Date(ms).toISOString().slice(0, 10)
      : new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const baseMs = Date.parse(time);
  const candidates = [];
  const heldSlot = resolvedSlots.get(product);
  if (heldSlot && Date.now() - heldSlot.at < 10 * 60_000)
    candidates.push(heldSlot.time);
  for (let step = 0; step <= 10; step += 1) {
    const label = slotLabel(baseMs - step * spec.stepMs);
    if (!candidates.includes(label)) candidates.push(label);
  }

  let lastError = null;
  for (const gibsTime of candidates) {
    try {
      const image = await fetchGibs(spec, gibsTime, box, width, height);
      resolvedSlots.set(product, { time: gibsTime, at: Date.now() });
      cache.set(key, { at: Date.now(), type: image.type, bytes: image.bytes });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      res.writeHead(200, {
        'Content-Type': image.type,
        'Cache-Control': 'public, max-age=60',
        'Content-Length': String(image.bytes.length),
      });
      res.end(image.bytes);
      return true;
    } catch (error) {
      lastError = error;
      // Only an unavailable slot is worth walking back; a timeout or a network
      // failure would just repeat itself.
      if (!/^GIBS HTTP 4\d\d/.test(String(error?.message || error))) break;
    }
  }
  console.warn(
    `[gev-bridge] global weather ${product} failed (${lastError?.message || lastError})`,
  );
  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      error: 'weather_image_unavailable',
      detail: String(
        lastError?.cause?.message || lastError?.message || lastError,
      ).slice(0, 160),
    }),
  );
  return true;
}
