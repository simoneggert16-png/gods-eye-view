// Country borders client. English stays data.
const msg = (text) => text;

export function createBordersSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: msg('Borders'),
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/borders', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error(msg(`Borders HTTP ${response.status}`));
      const body = await response.json();
      if (!Array.isArray(body?.features))
        throw new Error(msg('Malformed border snapshot'));
      signal?.throwIfAborted();
      return body;
    },
  };
}
