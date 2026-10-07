// SAVE SYSTEM V3 — mondes, parties complètes et réglages, stockés localement (hors connexion).
// Electron : un fichier JSON par élément dans le dossier de l'utilisateur. Navigateur : localStorage.
const LS = 'world-simulator:';
const desk = () => (window.desktop && window.desktop.store) || null;

export const Store = {
  async list(cat) {
    const d = desk();
    if (d) return d.list(cat);
    const out = [];
    try {
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k);
        if (!key.startsWith(LS + cat + ':')) continue;
        let meta = null;
        try { const data = JSON.parse(localStorage.getItem(key)); meta = data.meta || { name: data.name, year: data.year, updatedAt: data.updatedAt }; } catch (_) {}
        out.push({ id: key.slice((LS + cat + ':').length), meta, mtime: meta && meta.updatedAt ? Date.parse(meta.updatedAt) : 0 });
      }
    } catch (_) {}
    return out.sort((a, b) => b.mtime - a.mtime);
  },
  async read(cat, id) {
    const d = desk();
    if (d) return d.read(cat, id);
    try { const v = localStorage.getItem(LS + cat + ':' + id); return v ? JSON.parse(v) : null; } catch (_) { return null; }
  },
  async write(cat, id, data) {
    const d = desk();
    if (d) return d.write(cat, id, data);
    try { localStorage.setItem(LS + cat + ':' + id, JSON.stringify(data)); return true; } catch (e) { console.warn(e); return false; }
  },
  async remove(cat, id) {
    const d = desk();
    if (d) return d.remove(cat, id);
    try { localStorage.removeItem(LS + cat + ':' + id); } catch (_) {}
    return true;
  },
};

export function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
