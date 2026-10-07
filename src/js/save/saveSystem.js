// SAVE SYSTEM — sauvegarde locale des paramètres de simulation (hors connexion)
// Sous Electron : fichier JSON dans le dossier de l'utilisateur (via preload).
// Dans un navigateur : localStorage (mode test).

const KEY = 'frontieres-vives-saves';

function emptyStore() { return { version: 1, last: null, slots: [] }; }

async function readStore() {
  try {
    if (window.desktop && window.desktop.readSaves) return (await window.desktop.readSaves()) || emptyStore();
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : emptyStore();
  } catch (e) {
    console.warn('Lecture des sauvegardes impossible', e);
    return emptyStore();
  }
}

async function writeStore(store) {
  try {
    if (window.desktop && window.desktop.writeSaves) return await window.desktop.writeSaves(store);
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    console.warn('Écriture des sauvegardes impossible', e);
    return false;
  }
}

// Ne garde que les champs utiles d'une configuration
export function cleanConfig(cfg) {
  return {
    a: cfg.a, b: cfg.b,
    stats: cfg.stats, statsFor: cfg.statsFor, powerMult: cfg.powerMult,
    speed: cfg.speed, eventRate: cfg.eventRate,
    resolution: cfg.resolution, maxDuration: cfg.maxDuration,
    randomness: cfg.randomness, seed: cfg.seed,
    victoryRatio: cfg.victoryRatio,
  };
}

export const SaveSystem = {
  async list() {
    const s = await readStore();
    return s.slots || [];
  },
  async loadLast() {
    const s = await readStore();
    return s.last;
  },
  async saveLast(cfg) {
    const s = await readStore();
    s.last = cleanConfig(cfg);
    return writeStore(s);
  },
  async saveSlot(name, cfg) {
    const s = await readStore();
    s.slots = s.slots || [];
    const slot = { id: Date.now().toString(36), name: name || 'Simulation', date: new Date().toISOString(), config: cleanConfig(cfg) };
    s.slots.unshift(slot);
    s.slots = s.slots.slice(0, 40);
    await writeStore(s);
    return slot;
  },
  async deleteSlot(id) {
    const s = await readStore();
    s.slots = (s.slots || []).filter((x) => x.id !== id);
    return writeStore(s);
  },
};
