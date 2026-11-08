/**
 * AIS relay for God's Eye View.
 *
 * Vercel freezes the function between requests, so a websocket to AISStream
 * dies there (measured: the store collapses to a few hundred vessels after
 * every deploy). This Worker keeps the socket alive on a schedule and stores a
 * compact snapshot in KV; `/api/vessels` in the bridge reads it over HTTP.
 *
 * Cron every two minutes: connect, collect for ~45 s, write `rows` to KV.
 * A fetch invocation can also prime the snapshot (`/collect?ms=15000`).
 * AISStream allows one connection per key — the cron closes its socket before
 * the next run, so the relay never competes with itself.
 */

const STREAM = 'wss://stream.aisstream.io/v0/stream';
const MAX_ROWS = 20000;

export default {
  async scheduled(_event, env) {
    await collect(env, 45_000);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/debug') {
      const out = await debugCollect(env, Number(url.searchParams.get('ms')) || 8000);
      return json(out);
    }
    if (url.pathname === '/collect') {
      const ms = Math.min(Number(url.searchParams.get('ms')) || 15_000, 25_000);
      const result = await collect(env, ms);
      return json(result);
    }
    if (url.pathname === '/vessels') {
      const raw = await env.AIS.get('snapshot');
      return new Response(
        raw || JSON.stringify({ rows: [], updatedAt: 0, status: 'empty' }),
        {
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
          },
        },
      );
    }
    if (url.pathname === '/relay-url' && request.method === 'PUT') {
      if (!env.RELAY_TOKEN || request.headers.get('x-relay-token') !== env.RELAY_TOKEN)
        return new Response('{"error":"unauthorized"}', { status: 401 });
      const body = await request.json().catch(() => null);
      if (!body || typeof body.url !== 'string' || !/^https?:\/\//.test(body.url))
        return new Response('{"error":"bad_url"}', { status: 400 });
      await env.AIS.put('flights_relay', body.url.trim());
      return json({ ok: true, url: body.url.trim() });
    }
    if (url.pathname === '/flights' || url.pathname === '/mil') {
      const target = await env.AIS.get('flights_relay');
      if (!target)
        return new Response('{"error":"relay_offline"}', {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      const upstream = await fetch(target.replace(/\/$/, '') + url.pathname, {
        headers: {
          'x-relay-token': env.RELAY_TOKEN || '',
          Accept: 'application/json',
        },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'content-type':
            upstream.headers.get('content-type') || 'application/json',
          'cache-control': 'no-store',
        },
      });
    }
    if (url.pathname === '/health') {
      const raw = await env.AIS.get('snapshot');
      const parsed = raw ? JSON.parse(raw) : null;
      return json({
        ok: true,
        rows: parsed?.rows?.length ?? 0,
        updatedAt: parsed?.updatedAt ?? 0,
        status: parsed?.status ?? 'empty',
      });
    }
    return new Response('not found', { status: 404 });
  },
};

function json(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function debugCollect(env, durationMs) {
  const seen = [];
  let opened = false;
  const socket = new WebSocket(STREAM);
  socket.binaryType = 'arraybuffer';
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      resolve();
    }, durationMs);
    socket.onopen = () => {
      opened = true;
      socket.send(JSON.stringify({
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'],
        APIKey: env.AISSTREAM_API_KEY,
      }));
    };
    socket.onmessage = (event) => {
      if (seen.length >= 3) return;
      try {
        const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        seen.push(text.slice(0, 400));
      } catch (e) {
        seen.push('decode-error:' + String(e && e.message));
      }
    };
    socket.onclose = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => {};
  });
  return { opened, seen };
}

async function collect(env, durationMs) {
  if (!env.AISSTREAM_API_KEY) return;
  const rows = new Map();
  const socket = new WebSocket(STREAM);
  socket.binaryType = 'arraybuffer';
  let opened = false;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    const timer = setTimeout(finish, durationMs);
    socket.onopen = () => {
      opened = true;
      socket.send(
        JSON.stringify({
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FilterMessageTypes: [
            'PositionReport',
            'StandardClassBPositionReport',
            'ExtendedClassBPositionReport',
          ],
          APIKey: env.AISSTREAM_API_KEY,
        }),
      );
    };
    socket.onmessage = (event) => {
      try {
        const text =
          typeof event.data === 'string'
            ? event.data
            : event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : String(event.data);
        const payload = JSON.parse(text);
        const type = String(payload?.MessageType || '');
        if (
          type !== 'PositionReport' &&
          type !== 'StandardClassBPositionReport' &&
          type !== 'ExtendedClassBPositionReport'
        )
          return;
        const meta = payload.MetaData || {};
        const body =
          payload.Message?.PositionReport ||
          payload.Message?.StandardClassBPositionReport ||
          payload.Message?.ExtendedClassBPositionReport ||
          {};
        const lat = Number(meta.latitude ?? body.Latitude);
        const lon = Number(meta.longitude ?? body.Longitude);
        const mmsi = String(meta.MMSI || body.UserID || '').trim();
        if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const at = Date.parse(meta.time_utc) || Date.now();
        rows.set(mmsi, {
          mmsi,
          lat,
          lon,
          name: String(meta.ShipName || '').trim(),
          speed: Number.isFinite(Number(body.Sog)) ? Number(body.Sog) : null,
          course: Number.isFinite(Number(body.Cog)) ? Number(body.Cog) : null,
          heading: Number.isFinite(Number(body.TrueHeading))
            ? Number(body.TrueHeading)
            : null,
          last_position_epoch: Math.round(at / 1000),
          last_position_UTC: new Date(at).toISOString(),
        });
      } catch {
        /* a malformed frame must not end the batch */
      }
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      clearTimeout(timer);
      finish();
    };
  });

  // Merge with the previous snapshot: one 45 s window only sees a slice of the
  // fleet, so the store has to accumulate like the long-lived server did. Rows
  // are kept newest-first and stale contacts (older than 30 min) are dropped.
  const previous = await env.AIS.get('snapshot', { type: 'json' }).catch(
    () => null,
  );
  const merged = new Map();
  for (const row of previous?.rows || []) {
    const id = String(row?.mmsi || '');
    if (id) merged.set(id, row);
  }
  for (const [id, row] of rows) merged.set(id, row);
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 60;
  const list = [...merged.values()]
    .filter((row) => Number(row.last_position_epoch) >= cutoff)
    .sort(
      (a, b) =>
        Number(b.last_position_epoch || 0) - Number(a.last_position_epoch || 0),
    )
    .slice(0, MAX_ROWS);
  await env.AIS.put(
    'snapshot',
    JSON.stringify({
      rows: list,
      updatedAt: Date.now(),
      status: opened ? 'live' : 'closed',
    }),
  );
  return { collected: rows.size, stored: list.length, opened };
}
