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
const currentEpoch = () => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

// ─── POISON — par item (résistant à la moyenne inter-sessions) ───────────────
const clampPlausible = (v, min = 1) => Math.max(min, Math.round(v));

const poison = (value, itemKey, epoch) => {
    if (typeof value !== 'number') return value;
    const ep = epoch || currentEpoch();
    const shift = (hashInt(itemKey + ep) % 7) - 3; // [-3, +3], déterministe par item+époque
    return clampPlausible(value + shift);
};

// ─── REFRACT — point d'étranglement unique ────────────────────────────────────
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
                    out[key] = value;
                    break;
                case 'cosmetic':
                    out[key] = watermark(value, seed + key);
                    break;
                case 'aggregate':
                    out[key] = poison(value, `${row.id || key}:${key}`, ep);
                    break;
                default:
                    out[key] = value;
            }
        }
        return out;
    });
};

module.exports = { refract, watermark, poison, currentEpoch, hashInt };
