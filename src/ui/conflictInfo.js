import * as Cesium from 'cesium';
import { t } from '../i18n/index.js';

/**
 * Click summary for a conflict layer: pick an entity of the layer's data
 * source and show what it is, with a close button, Escape, or a click on empty
 * space dismissing it. Text is inserted as text nodes, never as HTML — the
 * headlines come from the open web.
 *
 * @param {Cesium.Viewer} viewer
 * @param {object} options
 * @param {string} options.prefix Entity-id prefix (e.g. `osint:`).
 * @param {(read:(key:string)=>string, entity:object)=>object} options.describe
 *   Returns `{title, lines: [[label, value], ...], link?: {href, text}}`.
 * @returns {{destroy:Function}}
 */
export function createInfoPopover(viewer, { prefix, describe }) {
  const element = document.createElement('div');
  element.className = 'gev-info-popover';
  element.hidden = true;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-live', 'polite');
  document.body.appendChild(element);

  const time = new Cesium.JulianDate();
  let handler = null;
  let escape = null;

  const hide = () => {
    element.hidden = true;
  };

  const render = (entity, screen) => {
    const props = entity.properties;
    const read = (key) => {
      try {
        const value = props?.[key]?.getValue?.(time);
        return value == null ? '' : String(value);
      } catch {
        return '';
      }
    };
    const info = describe(read, entity) || {};
    element.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = info.title || '';
    element.appendChild(title);
    for (const [label, value] of info.lines || []) {
      if (!value) continue;
      const row = document.createElement('div');
      row.className = 'gev-info-row';
      const key = document.createElement('span');
      key.className = 'gev-info-label';
      key.textContent = label;
      const val = document.createElement('span');
      val.textContent = value;
      row.append(key, val);
      element.appendChild(row);
    }
    if (info.link?.href) {
      const link = document.createElement('a');
      link.href = info.link.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = info.link.text || info.link.href;
      element.appendChild(link);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'gev-info-close';
    close.textContent = '×';
    close.setAttribute('aria-label', t('Close'));
    close.addEventListener('click', hide);
    element.appendChild(close);

    element.hidden = false;
    const canvas = viewer.scene.canvas;
    const rect = canvas.getBoundingClientRect();
    const width = element.offsetWidth || 280;
    const height = element.offsetHeight || 120;
    const x = Math.min(
      Math.max(8, rect.left + screen.x + 14),
      window.innerWidth - width - 8,
    );
    const y = Math.min(
      Math.max(8, rect.top + screen.y + 14),
      window.innerHeight - height - 8,
    );
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  };

  try {
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event) => {
      let picked = viewer.scene.pick(event.position);
      if (!picked?.id) {
        hide();
        return;
      }
      const entity = picked.id;
      if (typeof entity.id !== 'string' || !entity.id.startsWith(prefix)) {
        hide();
        return;
      }
      render(entity, event.position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  } catch {
    handler = null;
  }

  escape = (event) => {
    if (event.key === 'Escape') hide();
  };
  document.addEventListener('keydown', escape);

  return {
    destroy() {
      handler?.destroy?.();
      document.removeEventListener('keydown', escape);
      element.remove();
    },
  };
}
