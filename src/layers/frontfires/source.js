// Fires near the front line, filtered server-side. English stays data.
const msg = (text) => text;

/** Front-fire snapshot client. */
export function createFrontFiresSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: msg('Front fires'),
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/frontfires', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok)
        throw new Error(msg(`Front fires HTTP ${response.status}`));
      const body = await response.json();
      if (!Array.isArray(body?.fires))
        throw new Error(msg('Malformed front-fire snapshot'));
      signal?.throwIfAborted();
      return body;
    },
  };
}
