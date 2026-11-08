import { createFrontlineLayer } from '../../layers/frontline/index.js';
/** Wire the DeepState front line to the application catalog. */
export function createApplicationFrontline(options) {
  return createFrontlineLayer(options);
}
