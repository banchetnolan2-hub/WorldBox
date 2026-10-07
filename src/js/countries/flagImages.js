// COUNTRIES — drapeaux rasterisés pour le canvas (les emoji drapeaux ne s'affichent pas sous Windows)
import { flagUrl } from './countries.js';

const cache = new Map();

export function flagImage(country) {
  if (!country) return null;
  const key = country.id;
  if (cache.has(key)) return cache.get(key);
  const entry = { ready: false, canvas: document.createElement('canvas') };
  entry.canvas.width = 64; entry.canvas.height = 48;
  const img = new Image();
  img.onload = () => {
    const ctx = entry.canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 64, 48);
    entry.ready = true;
  };
  img.onerror = () => {
    const ctx = entry.canvas.getContext('2d');
    ctx.fillStyle = country.color; ctx.fillRect(0, 0, 64, 48);
    entry.ready = true;
  };
  img.src = flagUrl(country);
  cache.set(key, entry);
  return entry;
}

export function flagHtml(country, cls = 'flag') {
  if (!country) return '';
  return `<img class="${cls}" src="${flagUrl(country)}" alt="" draggable="false">`;
}
