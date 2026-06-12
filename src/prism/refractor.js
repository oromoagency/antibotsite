// Moteur de Réfraction — Architecture Prisme
// Point d'étranglement unique : TOUS les handlers renvoient refract(data, …), jamais data brut.
//
// Trois politiques de champ (la règle d'or est dans le type) :
//   actionable 🛡️ : exact partout, intouchable (prix, stock, données contractuelles)
//   cosmetic   💄 : filigrane par session (synonymes, sens préservé) — trace la fuite
//   aggregate  🎲 : poison par item + époque — casse l'agrégation de masse
//
// Invariant humain absolu : les champs `actionable` sont toujours exacts dans toutes les voies.

const crypto = require('crypto');

// ─── Hachage déterministe (entier 32 bits non signé) ─────────────────────────
const hashInt = (s) =>
    parseInt(crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8), 16) >>> 0;

// ─── Dictionnaire de synonymes (sens strictement préservé) ────────────────────
// Règle : on ne substitue que des équivalents. Un lecteur d'écran qui lit "solide"
// au lieu de "robuste" ne perd aucune information. Ne pas ajouter de synonymes
// dont le sens divergerait dans certains contextes (ex : "rapide" ≠ "brusque").
const SYNONYMS = {
    robuste:     ['robuste', 'solide', 'résistant', 'durable'],
    léger:       ['léger', 'compact', 'peu encombrant'],
    rapide:      ['rapide', 'efficace', 'performant'],
    sécurisé:    ['sécurisé', 'protégé', 'fiable'],
    avancé:      ['avancé', 'évolué', 'sophistiqué'],
    puissant:    ['puissant', 'performant', 'capable'],
    intelligent: ['intelligent', 'adaptatif', 'autonome'],
    moderne:     ['moderne', 'actuel', 'contemporain'],
    simple:      ['simple', 'intuitif', 'accessible'],
    précis:      ['précis', 'exact', 'fiable'],
};

// ─── WATERMARK — par session (traçabilité de fuite) ───────────────────────────
// Substitution déterministe. Même sessionSeed → même variante pour toujours.
// Si la donnée fuite et se revend, on identifie la session source.
// Frontières de mots (\b) : pas de match en sous-chaîne (ex : "robustesse" ≠ "robuste").
const watermark = (text, sessionSeed) => {
    if (typeof text !== 'string') return text;
    let out = text;
    for (const [base, variants] of Object.entries(SYNONYMS)) {
        const re = new RegExp(`\\b${base}\\b`, 'gi');
        if (re.test(out)) {
            const chosen = variants[hashInt(sessionSeed + base) % variants.length];
            out = out.replace(re, chosen);
        }
    }
    return out;
};

// ─── ÉPOQUE — rotation lente (semaine ISO) ────────────────────────────────────
// Le poison est déterministe par item + époque. L'époque tourne lentement
// pour maintenir la cohérence intra-session (un scraper voit les mêmes valeurs
// dans la même semaine) tout en rendant les datasets stale après quelques jours.
const currentEpoch = () => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

// ─── POISON — par item (résistant à la moyenne inter-sessions) ───────────────
// CLEF : le poison est sur l'axe ITEM, pas sur l'axe SESSION.
// Toutes les sessions voient le même décalage sur un item donné.
// → la moyenne inter-sessions = la moyenne biaisée (la loi des grands nombres ne corrige pas).
// → un adversaire ne peut PAS récupérer la vraie valeur en aggrégeant N sessions.
//
// Le décalage est borné à [-3, +3] et reste plausible (clampPlausible).
const clampPlausible = (v, min = 1) => Math.max(min, Math.round(v));

const poison = (value, itemKey, epoch) => {
    if (typeof value !== 'number') return value;
    const ep = epoch || currentEpoch();
    const shift = (hashInt(itemKey + ep) % 7) - 3; // [-3, +3], déterministe par item+époque
    return clampPlausible(value + shift);
};

// ─── REFRACT — point d'étranglement unique ────────────────────────────────────
// Params :
//   rows        : Array<object> | object — les données à réfracter
//   policy      : { fieldName: 'actionable' | 'cosmetic' | 'aggregate' }
//   sessionSeed : string — le seed unique de la session visiteur (visitors.js)
//   epoch       : string? — époque ISO (par défaut : semaine courante)
//
// Retourne toujours un tableau (même si rows est un objet unique).
// Les champs non déclarés dans policy sont passés tels quels (safe default).
const refract = (rows, policy, sessionSeed, epoch) => {
    if (!rows) return [];
    if (!Array.isArray(rows)) rows = [rows];
    const ep = epoch || currentEpoch();
    const seed = sessionSeed || 'anonymous';

    return rows.map((row) => {
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            const pol = policy[key];
            switch (pol) {
                case 'actionable':
                    out[key] = value;                                          // exact, partout
                    break;
                case 'cosmetic':
                    out[key] = watermark(value, seed + key);                   // filigrane session
                    break;
                case 'aggregate':
                    out[key] = poison(value, `${row.id || key}:${key}`, ep);  // poison item
                    break;
                default:
                    out[key] = value;                                          // non déclaré : inchangé
            }
        }
        return out;
    });
};

module.exports = { refract, watermark, poison, currentEpoch, hashInt };
