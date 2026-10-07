// UI — THÈMES D'INTERFACE : plusieurs styles visuels cohérents pour toute l'interface, et la taille de
// l'interface. Uniquement de la présentation (variables CSS) : aucun effet sur les règles ni sur la
// simulation ; le réglage est propre à chaque ordinateur (paramètres locaux, jamais dans les sauvegardes).
export const THEMES = [
  { id: 'cartes', label: 'Salle des cartes', desc: 'Encre marine, parchemin et laiton (par défaut)', sw: ['#07111a', '#ece6d6', '#d4ab5c'] },
  { id: 'polaire', label: 'Nuit polaire', desc: 'Bleu nuit et acier, sobre et froid', sw: ['#08111d', '#e6eef7', '#66b6e6'] },
  { id: 'operations', label: 'État-major', desc: 'Kaki et olive, ambiance opérationnelle', sw: ['#0b100b', '#e6ebd8', '#a6c660'] },
  { id: 'atlas', label: 'Atlas clair', desc: 'Papier clair et encre brune, pour les pièces lumineuses', sw: ['#f4efe2', '#1f1a11', '#946512'] },
  { id: 'contraste', label: 'Contraste élevé', desc: 'Noir, blanc et jaune : lisibilité maximale', sw: ['#000000', '#ffffff', '#ffd400'] },
];
export const UI_SIZES = [{ value: 0.9, label: '90 %' }, { value: 1, label: '100 %' }, { value: 1.12, label: '112 %' }, { value: 1.25, label: '125 %' }, { value: 1.4, label: '140 %' }];
export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));

export function applyTheme(settings) {
  const root = document.documentElement;
  const id = THEME_BY_ID[settings.theme] ? settings.theme : 'cartes';
  if (id === 'cartes') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', id);
  const z = Number(settings.uiScale) || 1;
  root.style.setProperty('--ui-zoom', String(Math.max(0.8, Math.min(1.5, z))));
}

export function themePickerHtml(current) {
  return THEMES.map((t) => `<button class="theme-opt ${t.id === (current || 'cartes') ? 'on' : ''}" data-theme-id="${t.id}" title="${t.desc}"><span class="sw">${t.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span><b>${t.label}</b><small>${t.desc}</small></button>`).join('');
}
