// Contexte géopolitique de départ (NATION SIMULATOR) : grandes organisations et alliances réelles,
// rivalités connues. Il fixe uniquement l'état initial (relations, alliances défensives, accords
// commerciaux) ; ensuite tout évolue selon les décisions du joueur et des IA.
export const BLOCS = [
  { id: 'otan', name: 'OTAN', kind: 'alliance', rel: 35, members: ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'DK', 'NO', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'TR', 'HR', 'SI', 'AL', 'ME', 'MK', 'EE', 'LV', 'LT', 'FI', 'SE'] },
  { id: 'ue', name: 'Union européenne', kind: 'trade', rel: 20, members: ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'DK', 'IE', 'AT', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'EE', 'LV', 'LT', 'FI', 'SE', 'CY', 'MT'] },
  { id: 'otsc', name: 'OTSC', kind: 'partner', rel: 30, members: ['RU', 'BY', 'KZ', 'KG', 'TJ'] },
  { id: 'etat-union', name: 'État de l\'Union', kind: 'alliance', rel: 40, members: ['RU', 'BY'] },
  { id: 'mercosur', name: 'Mercosur', kind: 'trade', rel: 20, members: ['AR', 'BR', 'PY', 'UY', 'BO'] },
  { id: 'asean', name: 'ASEAN', kind: 'trade', rel: 15, members: ['ID', 'MY', 'PH', 'SG', 'TH', 'VN', 'BN', 'KH', 'LA', 'MM'] },
  { id: 'ccg', name: 'Conseil de coopération du Golfe', kind: 'trade', rel: 25, members: ['SA', 'AE', 'QA', 'KW', 'BH', 'OM'] },
  { id: 'aukus', name: 'AUKUS', kind: 'alliance', rel: 30, members: ['AU', 'GB', 'US'] },
  { id: 'anzus', name: 'Alliances du Pacifique', kind: 'alliance', rel: 30, members: ['US', 'JP', 'KR', 'AU', 'NZ', 'PH'] },
  { id: 'aes', name: 'Alliance des États du Sahel', kind: 'alliance', rel: 30, members: ['ML', 'BF', 'NE'] },
  { id: 'brics', name: 'BRICS', kind: 'partner', rel: 12, members: ['BR', 'RU', 'IN', 'CN', 'ZA', 'EG', 'ET', 'IR', 'AE', 'ID'] },
  { id: 'ua', name: 'Union africaine', kind: 'partner', rel: 6, members: [] },
];
// rivalités et tensions connues (relation de départ)
export const RIVALRIES = [
  ['US', 'IR', -55], ['US', 'KP', -70], ['KR', 'KP', -65], ['JP', 'KP', -55], ['IN', 'PK', -55], ['IL', 'IR', -75], ['RU', 'UA', -85],
  ['CN', 'TW', -60], ['AM', 'AZ', -55], ['SA', 'IR', -40], ['GR', 'TR', -15], ['US', 'RU', -45], ['US', 'CN', -30], ['GB', 'RU', -45],
  ['PL', 'RU', -50], ['EE', 'RU', -45], ['LV', 'RU', -45], ['LT', 'RU', -50], ['FI', 'RU', -40], ['UA', 'BY', -40], ['IN', 'CN', -25],
  ['JP', 'CN', -20], ['VN', 'CN', -15], ['PH', 'CN', -25], ['MA', 'DZ', -35], ['ET', 'ER', -35], ['SD', 'SS', -30], ['VE', 'GY', -35],
  ['RS', 'XK', -50], ['CY', 'TR', -40], ['IL', 'LB', -50], ['IL', 'SY', -50], ['RW', 'CD', -45], ['AF', 'PK', -30], ['EG', 'ET', -25],
];
// partenariats proches (relation de départ)
export const FRIENDSHIPS = [
  ['US', 'IL', 50], ['US', 'GB', 55], ['FR', 'DE', 55], ['US', 'JP', 50], ['US', 'KR', 50], ['RU', 'CN', 35], ['CN', 'PK', 45], ['RU', 'IR', 30],
  ['CN', 'KP', 35], ['RU', 'KP', 30], ['IN', 'RU', 20], ['SA', 'AE', 50], ['AU', 'NZ', 60], ['CA', 'US', 55], ['GB', 'IE', 30], ['ES', 'PT', 50],
  ['AR', 'UY', 40], ['TR', 'AZ', 55], ['RU', 'SY', 35], ['US', 'UA', 35], ['FR', 'BE', 50], ['SE', 'NO', 55], ['FI', 'SE', 55], ['DK', 'NO', 50],
];

// personnalités de départ des IA (tendances générales, modifiables par la situation)
export const PERSONALITY_HINTS = {
  US: 'technological', CN: 'technological', JP: 'technological', KR: 'technological', DE: 'economic', FR: 'diplomatic', GB: 'maritime', IT: 'economic',
  ES: 'economic', NL: 'economic', BE: 'diplomatic', CH: 'isolationist', SE: 'diplomatic', NO: 'diplomatic', DK: 'diplomatic', FI: 'defensive', CA: 'diplomatic',
  AU: 'maritime', NZ: 'diplomatic', IN: 'economic', BR: 'economic', MX: 'economic', AR: 'economic', ZA: 'diplomatic', NG: 'economic', SG: 'economic', ID: 'maritime',
  SA: 'economic', AE: 'economic', QA: 'economic', IL: 'defensive', PL: 'defensive', UA: 'defensive', TW: 'defensive', PK: 'defensive', EG: 'defensive',
  VN: 'economic', TH: 'economic', MY: 'economic', PH: 'maritime', IE: 'economic', AT: 'isolationist', PT: 'maritime', GR: 'defensive', CL: 'economic',
};

const sideById = (sim) => {
  const m = new Map();
  sim.sides.forEach((s, k) => { const e = sim.entities[s.e]; if (e && e.id) m.set(e.id, k); });
  return m;
};

export function blocsOf(id) { return BLOCS.filter((b) => b.members.includes(id)); }
export function rivalsOf(id) { return RIVALRIES.filter((r) => r[0] === id || r[1] === id).map((r) => ({ id: r[0] === id ? r[1] : r[0], rel: r[2] })); }
export function friendsOf(id) {
  const out = FRIENDSHIPS.filter((r) => r[0] === id || r[1] === id).map((r) => ({ id: r[0] === id ? r[1] : r[0], rel: r[2] }));
  for (const b of blocsOf(id)) if (b.kind === 'alliance') for (const m of b.members) if (m !== id && !out.some((x) => x.id === m)) out.push({ id: m, rel: b.rel, bloc: b.name });
  return out;
}

// applique le contexte de départ ; retourne la liste des accords commerciaux à enregistrer
export function applyGeopolitics(sim) {
  const S = sim.S;
  const idx = sideById(sim);
  const setRel = (a, b, v, mode = 'max') => {
    const x = a * S + b, y = b * S + a;
    const nv = mode === 'set' ? v : mode === 'max' ? Math.max(sim.rel[x], v) : sim.rel[x] + v;
    sim.rel[x] = sim.rel[y] = Math.max(-100, Math.min(100, nv));
  };
  const trades = [];
  for (const [id, pers] of Object.entries(PERSONALITY_HINTS)) { const k = idx.get(id); if (k !== undefined && sim.sides[k].ai) { sim.sides[k].ai.personality = pers; sim.sides[k].p.personality = pers; } }
  for (const b of BLOCS) {
    const ks = b.members.map((id) => idx.get(id)).filter((k) => k !== undefined);
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], c = ks[j];
      setRel(a, c, b.rel + ((a * 7 + c * 3) % 9), 'max');
      if (b.kind === 'alliance' && sim.rules.alliances !== false) sim.allied[a * S + c] = sim.allied[c * S + a] = 1;
      if (b.kind === 'trade') trades.push([a, c]);
    }
  }
  for (const [x, y, v] of FRIENDSHIPS) { const a = idx.get(x), c = idx.get(y); if (a !== undefined && c !== undefined) setRel(a, c, v, 'max'); }
  for (const [x, y, v] of RIVALRIES) { const a = idx.get(x), c = idx.get(y); if (a !== undefined && c !== undefined) { setRel(a, c, v, 'set'); sim.allied[a * S + c] = sim.allied[c * S + a] = 0; } }
  return trades;
}
