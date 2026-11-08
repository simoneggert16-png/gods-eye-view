/**
 * Cameras the operator wants on the map even though no keyless directory
 * carries them: pinned public still feeds, served by the bridge itself.
 *
 * Why pinned at all: Windy's free tier answers at most 1 000 cameras per
 * country (offset cap), so the Rheintal valley never makes it into the crawled
 * catalog, and the Swiss/Austrian directories list nothing in these villages.
 * What does exist are the villages' own feeds — a still JPEG per camera, some
 * republished every minute, some every half hour.
 *
 * Two provider shapes are supported:
 *  - `avisec`: the venue embeds an AvisEC/YellowCamera player; a keyless
 *    descriptor names the newest picture (a signed S3 URL that expires within
 *    the hour) next to its capture time.
 *  - `image`: a plain JPEG URL; the capture time is the response's
 *    `Last-Modified`, read with a HEAD when the catalog loads.
 *
 * Contract, matching the Windy pack: `pinnedCameras()` answers catalog items for
 * `/api/cctv/sources`, `pinnedCamera(id)` one item, and `pinnedCameraFrame()`
 * the JPEG plus the time it was taken, so the panel's age line and REFRESH work
 * the same way here as for every other feed.
 */

const AVISEC_API = 'https://avisec.com/api/webcam/feed/content';
const LIST_TTL_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {object} PinnedCamera
 * @property {string} id
 * @property {string} name
 * @property {string} city
 * @property {number} lat
 * @property {number} lon
 * @property {'avisec'|'image'} kind
 * @property {string} [feed] AvisEC feed id.
 * @property {string} [url] Still-image URL.
 * @property {string} provider
 * @property {string} credit
 * @property {string} detailUrl
 */

/** @type {PinnedCamera[]} */
const CAMERAS = Object.freeze([
  // --- Diepoldsau ---------------------------------------------------------
  {
    id: 'diepoldsau-schmitterpark-1',
    name: 'Schmitterpark · Webcam 1',
    city: 'Diepoldsau',
    lat: 47.3881326,
    lon: 9.6591429,
    kind: 'avisec',
    feed: 'D9KWUPSO1',
    provider: 'AvisEC',
    credit: 'schmitterpark.ch',
    detailUrl: 'https://www.schmitterpark.ch/webcam/live.html',
  },
  {
    id: 'diepoldsau-schmitterpark-2',
    name: 'Schmitterpark · Webcam 2',
    city: 'Diepoldsau',
    // 60 m north-east of Webcam 1 on the same grounds: the venue publishes no
    // per-camera position, and a tighter offset collapsed the two markers into
    // one icon at the zoom levels the valley is watched at.
    lat: 47.388513,
    lon: 9.659706,
    kind: 'avisec',
    feed: '5K98WKXOQ',
    provider: 'AvisEC',
    credit: 'schmitterpark.ch',
    detailUrl: 'https://www.schmitterpark.ch/webcam/webcam-2.html',
  },
  // --- Buchs ---------------------------------------------------------------
  // The Ortsgemeinde's Buchserberg cams: three stills the municipality site
  // republishes about once a minute, each with a burned-in timestamp. They look
  // from the mountain station down over Buchs and the Rhine valley.
  {
    id: 'buchs-berghaus',
    name: 'Buchserberg · Berghaus',
    city: 'Buchs',
    lat: 47.1526,
    lon: 9.4426,
    kind: 'image',
    url: 'https://www.livestream.ortsgemeinde-buchs.ch/Portals/0/Webcam/Berghaus.jpg',
    provider: 'Ortsgemeinde Buchs',
    credit: 'ortsgemeinde-buchs.ch',
    detailUrl: 'https://www.livestream.ortsgemeinde-buchs.ch/',
  },
  {
    id: 'buchs-parkplatz',
    name: 'Buchserberg · Parkplatz',
    city: 'Buchs',
    lat: 47.15214,
    lon: 9.44306,
    kind: 'image',
    url: 'https://www.livestream.ortsgemeinde-buchs.ch/Portals/0/Webcam/Parkplatz.jpg',
    provider: 'Ortsgemeinde Buchs',
    credit: 'ortsgemeinde-buchs.ch',
    detailUrl: 'https://www.livestream.ortsgemeinde-buchs.ch/',
  },
  {
    id: 'buchs-skilift',
    name: 'Buchserberg · Skilift',
    city: 'Buchs',
    lat: 47.1524,
    lon: 9.4435,
    kind: 'image',
    url: 'https://www.livestream.ortsgemeinde-buchs.ch/Portals/0/Webcam/Skilift.jpg',
    provider: 'Ortsgemeinde Buchs',
    credit: 'ortsgemeinde-buchs.ch',
    detailUrl: 'https://www.livestream.ortsgemeinde-buchs.ch/',
  },
  // --- Berneck ------------------------------------------------------------
  {
    id: 'berneck-rheintalwetter',
    name: 'Rheintalwetter · Dorfblick',
    city: 'Berneck',
    lat: 47.4274157,
    lon: 9.6095438,
    kind: 'image',
    url: 'https://rheintalwetter.ch/wetter/webcam/webcam.jpg',
    provider: 'Rheintalwetter',
    credit: 'rheintalwetter.ch',
    detailUrl: 'https://rheintalwetter.ch/',
  },
  // --- Hard (AT) ----------------------------------------------------------
  {
    id: 'hard-yachtclub-nord',
    name: 'Yachtclub · Nord',
    city: 'Hard',
    lat: 47.49905,
    lon: 9.68625,
    kind: 'image',
    url: 'https://www.foto-webcam.eu/webcam/yc-hard-nord/current/1200.jpg',
    provider: 'foto-webcam.eu',
    credit: 'foto-webcam.eu',
    detailUrl: 'https://www.foto-webcam.eu/webcam/yc-hard-nord/',
  },
]);

const byId = new Map(CAMERAS.map((camera) => [camera.id, camera]));
/** @type {Map<string, {at:number,image:string,time:number}>} */
const listCache = new Map();
/** @type {Map<string, {at:number,type:string,bytes:Buffer,capturedAt:number}>} */
const frameCache = new Map();
/** @type {Map<string, number>} Capture time learned without the picture. */
const headTimes = new Map();

async function newestAvisecPicture(camera, { fresh = false } = {}) {
  const held = listCache.get(camera.id);
  if (!fresh && held && Date.now() - held.at < LIST_TTL_MS) return held;
  const response = await fetch(AVISEC_API + '/' + camera.feed, {
    headers: { Accept: 'application/json', 'User-Agent': 'gods-eye-view/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
  const list = await response.json();
  const newest = Array.isArray(list) ? list[0] : null;
  const image = String(newest?.image || '');
  if (!/^https:\/\//.test(image)) throw new Error('feed has no picture');
  const entry = { at: Date.now(), image, time: Date.parse(newest?.time) || 0 };
  listCache.set(camera.id, entry);
  return entry;
}

/** When a plain still was published, without downloading it. */
async function stillLastModified(camera) {
  const response = await fetch(camera.url, {
    method: 'HEAD',
    headers: { Accept: 'image/*', 'User-Agent': 'gods-eye-view/1.0' },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return 0;
  return Date.parse(response.headers.get('last-modified') || '') || 0;
}

/**
 * Catalog items for the map; the picture URL stays in the bridge. The capture
 * time is read first — from the AvisEC descriptor, or with a HEAD on a still —
 * so the age line is the provider's own time as soon as the catalog loads.
 */
export async function pinnedCameras() {
  await Promise.all(
    CAMERAS.map(async (camera) => {
      if (camera.kind === 'avisec')
        await newestAvisecPicture(camera).catch(() => null);
      else {
        const time = await stillLastModified(camera).catch(() => 0);
        if (time) headTimes.set(camera.id, time);
      }
    }),
  );
  return CAMERAS.map((camera) => ({
    id: camera.id,
    pack: 'Pinned feeds',
    name: camera.name,
    city: camera.city,
    cityId: '',
    country: isAustrian(camera) ? 'AT' : 'CH',
    provider: camera.provider,
    lat: camera.lat,
    lon: camera.lon,
    feedType: 'image',
    sourceKind: 'configured',
    license: camera.credit,
    credit: camera.credit,
    code: '',
    updatedAt: listCache.get(camera.id)?.time || headTimes.get(camera.id) || 0,
  }));
}

/** Austria in this pack: Lustenau and Hard are the Rhine's left bank. */
function isAustrian(camera) {
  return camera.city === 'Lustenau' || camera.city === 'Hard';
}

/** One pinned camera by catalog id. */
export function pinnedCamera(id) {
  return byId.get(String(id || '')) || null;
}

/**
 * The camera's current JPEG and the moment it was taken.
 * @param {PinnedCamera} camera Pinned camera record.
 * @param {{bust?:boolean}} [options] `bust` skips every cache for REFRESH.
 */
export async function pinnedCameraFrame(camera, { bust = false } = {}) {
  const held = frameCache.get(camera.id);
  // The picture changes about once a minute (or every half hour on the
  // foto-webcam network); a short reuse keeps the panel and the projection
  // from double-fetching within the same second.
  if (!bust && held && Date.now() - held.at < 10_000)
    return {
      type: held.type,
      bytes: held.bytes,
      capturedAt: held.capturedAt,
    };
  const source =
    camera.kind === 'avisec'
      ? (await newestAvisecPicture(camera, { fresh: bust })).image
      : camera.url;
  const response = await fetch(source, {
    headers: {
      Accept: 'image/jpeg,image/*',
      'User-Agent': 'gods-eye-view/1.0',
      // A refresh must not be answered by a shared cache. The AvisEC picture is
      // an S3 signed URL: an added query parameter would invalidate the
      // signature (HTTP 403), so only these headers ask for a fresh copy.
      ...(bust ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } : {}),
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`picture HTTP ${response.status}`);
  const type = response.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error('picture is not an image');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 64 || bytes.length > MAX_BYTES)
    throw new Error('picture size out of bounds');
  const lastModified =
    Date.parse(response.headers.get('last-modified') || '') || 0;
  const capturedAt =
    (camera.kind === 'avisec' ? listCache.get(camera.id)?.time : 0) ||
    lastModified ||
    headTimes.get(camera.id) ||
    Date.now();
  frameCache.set(camera.id, { at: Date.now(), type, bytes, capturedAt });
  return { type, bytes, capturedAt };
}
