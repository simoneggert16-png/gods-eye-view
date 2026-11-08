// Front line and occupied areas (DeepState), through the bridge's cached
// snapshot. The English stays data: the layer panel translates what it shows.
const msg = (text) => text;

/** DeepState snapshot client. */
export function createFrontlineSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: msg('Front line'),
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/frontline', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok)
        throw new Error(msg(`Front line HTTP ${response.status}`));
      const body = await response.json();
      const features = body?.map?.features;
      if (!Array.isArray(features))
        throw new Error(msg('Malformed front line snapshot'));
      signal?.throwIfAborted();
      return {
        updatedAt: body?.datetime || null,
        features,
      };
    },
  };
}
