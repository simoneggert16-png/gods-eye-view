import { createFrontFiresLayer } from '../../layers/frontfires/index.js';
/** Wire the front-fire overlay to the application catalog. */
export function createApplicationFrontFires(options) {
  return createFrontFiresLayer(options);
}
