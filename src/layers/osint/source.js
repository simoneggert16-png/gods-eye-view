// Geocoded OSINT headlines. English stays data.
const msg = (text) => text;

/** OSINT report client. */
export function createOsintSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: msg('OSINT reports'),
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/osint/reports', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error(msg(`OSINT HTTP ${response.status}`));
      const body = await response.json();
      if (!Array.isArray(body?.reports))
        throw new Error(msg('Malformed OSINT snapshot'));
      signal?.throwIfAborted();
      return body;
    },
  };
}
