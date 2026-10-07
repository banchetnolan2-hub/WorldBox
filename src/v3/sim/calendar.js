// CALENDRIER — 1 seconde simulée = 3 jours. Une simulation de 5 min ≈ 2 ans et demi.
export const DAYS_PER_SEC = 3;
export const MONTH_SEC = 10;          // 30 jours
export const YEAR_SEC = 365 / DAYS_PER_SEC;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_S = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// startDay : jours écoulés depuis le 1er janvier 2025 au début de la simulation
export function dateParts(t, startDay = 0) {
  const d = new Date(Date.UTC(2025, 0, 1) + Math.floor(startDay + t * DAYS_PER_SEC) * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
export function fmtDate(t, startDay = 0, short = false) {
  const p = dateParts(t, startDay);
  return short ? `${MONTHS_S[p.m]} ${p.y}` : `${p.d} ${MONTHS[p.m]} ${p.y}`;
}
export function fmtDateDays(days) { return fmtDate(0, days); }
export function fmtDuration(sec) {
  const days = Math.max(0, Math.round(sec * DAYS_PER_SEC));
  const y = Math.floor(days / 365), m = Math.floor((days % 365) / 30.4), d = Math.round(days - y * 365 - m * 30.4);
  const parts = [];
  if (y) parts.push(`${y} an${y > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} mois`);
  if (!y && (!m || d >= 1) && (d > 0 || !m)) parts.push(`${Math.max(1, d)} jour${d > 1 ? 's' : ''}`);
  return parts.slice(0, 2).join(' ');
}
