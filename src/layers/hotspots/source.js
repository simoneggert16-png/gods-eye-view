// Conflict hotspots client: derives density cells from the OSINT reports.
const msg = (text) => text;

export function createHotspotsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: msg('Conflict hotspots'),
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/osint/reports', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok)
        throw new Error(msg(`Hotspots HTTP ${response.status}`));
      const body = await response.json();
      if (!Array.isArray(body?.reports))
        throw new Error(msg('Malformed hotspot snapshot'));
      signal?.throwIfAborted();
      return body;
    },
  };
}
