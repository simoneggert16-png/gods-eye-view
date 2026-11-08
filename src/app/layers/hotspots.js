import { createHotspotsLayer } from '../../layers/hotspots/index.js';
/** Wire the derived conflict hotspots to the application catalog. */
export function createApplicationHotspots(options) {
  return createHotspotsLayer(options);
}
