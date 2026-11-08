import { createFrontlineLayer } from '../layers/frontline/index.js';
import { createFrontlineSource } from '../layers/frontline/source.js';
import { createApplicationFrontline } from '../app/layers/frontline.js';
export * from '../layers/frontline/index.js';
/** Wire the standalone source and the application layer owner. */
export function createFrontlineLayerWithSource({
  source = createFrontlineSource(),
  ...options
} = {}) {
  return createApplicationFrontline({ source, ...options });
}
