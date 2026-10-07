// petites règles de français pour les textes générés
const VOW = /^[aeiouyéèêàâîïôûh]/i;
const H_ASP = /^(hongrie|honduras|haïti|hollande)/i;
const PLUR = /^(États-Unis|Pays-Bas|Émirats|Philippines|Comores|Maldives|Seychelles|Bahamas|Fidji|Îles|Samoa américaines)/;
export const de = (n) => PLUR.test(n) ? `des ${n}` : (VOW.test(n) && !H_ASP.test(n) ? `d'${n}` : `de ${n}`);
const ORD = ['', 'Deuxième ', 'Troisième ', 'Quatrième ', 'Cinquième ', 'Sixième ', 'Septième '];
export const ordinalF = (k) => (k < ORD.length ? ORD[k] : `${k + 1}e `);
