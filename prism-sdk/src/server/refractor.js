/**
 * refractor.js — Moteur de Réfraction Prisme
 *
 * Point d'étranglement unique : TOUS les handlers renvoient refract(data), jamais data brut.
 *
 * Invariant humain absolu :
 *   actionable 🛡️ — exact partout, intouchable (prix, stock, SKU, clauses légales)
 *   cosmetic   💄 — watermark par session (sens préservé, traçable si fuite)
 *   aggregate  🎲 — poison par item+époque (résistant à la moyenne inter-sessions)
 *
 * Le watermark encode l'empreinte de session dans plusieurs canaux indépendants :
 *   - substitution de synonymes (canal sémantique)
 *   - formatage des nombres (canal typographique)
 *   - séquence de champs (canal structurel — au niveau row, non au niveau clé)
 *
 * Le poison est DÉTERMINISTE par (itemId, fieldKey, epoch) — jamais par session.
 * Si chaque session voit le même offset, la moyenne inter-sessions ne révèle rien.
 */

const crypto = require('crypto');

// ─── Hachage déterministe (uint32) ────────────────────────────────────────────
const hashInt = (s) =>
    parseInt(crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8), 16) >>> 0;

// ─── Époque — rotation hebdomadaire ──────────────────────────────────────────
const currentEpoch = () => {
    const d    = new Date();
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

// ─── Canal 1 : Synonymes (français + anglais, sens strictement préservé) ─────
const SYNONYMS = {
    // Français
    robuste:      ['robuste', 'solide', 'resistant', 'durable'],
    leger:        ['leger', 'compact', 'peu encombrant'],
    rapide:       ['rapide', 'efficace', 'performant'],
    securise:     ['securise', 'protege', 'fiable'],
    avance:       ['avance', 'evolue', 'sophistique'],
    puissant:     ['puissant', 'performant', 'capable'],
    intelligent:  ['intelligent', 'adaptatif', 'autonome'],
    moderne:      ['moderne', 'actuel', 'contemporain'],
    simple:       ['simple', 'intuitif', 'accessible'],
    precis:       ['precis', 'exact', 'fiable'],
    stable:       ['stable', 'fiable', 'constant'],
    optimise:     ['optimise', 'affine', 'ameliore'],
    flexible:     ['flexible', 'adaptable', 'modulaire'],
    complet:      ['complet', 'exhaustif', 'integre'],
    efficace:     ['efficace', 'optimal', 'performant'],
    // English
    robust:       ['robust', 'sturdy', 'resilient', 'durable'],
    lightweight:  ['lightweight', 'compact', 'low-bulk', 'lean'],
    fast:         ['fast', 'quick', 'rapid', 'swift'],
    secure:       ['secure', 'protected', 'reliable', 'safe'],
    advanced:     ['advanced', 'sophisticated', 'enhanced'],
    powerful:     ['powerful', 'capable', 'high-performance'],
    smart:        ['smart', 'intelligent', 'adaptive'],
    modern:       ['modern', 'current', 'up-to-date'],
    simple:       ['simple', 'intuitive', 'straightforward'],
    accurate:     ['accurate', 'precise', 'exact'],
    stable:       ['stable', 'consistent', 'dependable'],
    optimized:    ['optimized', 'tuned', 'refined'],
    flexible:     ['flexible', 'adaptable', 'modular'],
    complete:     ['complete', 'comprehensive', 'full-featured'],
    efficient:    ['efficient', 'effective', 'streamlined'],
};

// Substitution en respectant les frontières de mots (évite les sous-chaînes)
function watermarkText(text, sessionSeed) {
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
}

// ─── Canal 2 : Formatage numérique (entier ou flottant) ───────────────────────
// Varie le séparateur de milliers selon un hash de session → trace sans altérer la valeur.
const NUM_FORMATS = [
    (n) => String(n),                                           // 1234
    (n) => n.toLocaleString('fr-FR'),                          // 1 234
    (n) => n.toLocaleString('en-US'),                          // 1,234
    (n) => n.toLocaleString('de-DE'),                          // 1.234
];
function watermarkNumber(value, sessionSeed, key) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000) return value;
    const fmtIdx = hashInt(sessionSeed + key) % NUM_FORMATS.length;
    return NUM_FORMATS[fmtIdx](value);
}

// ─── Canal 3 : Watermark combiné pour champ cosmetic ─────────────────────────
function watermark(value, sessionSeed, key) {
    if (typeof value === 'string')  return watermarkText(value, sessionSeed + key);
    if (typeof value === 'number')  return watermarkNumber(value, sessionSeed, key);
    return value;
}

// ─── POISON — par item+époque (déterministe, résistant à la moyenne) ──────────
// Le même offset est vu par TOUTES les sessions → la moyenne inter-sessions ne l'annule pas.
// Décalage structurel : [-3, +3] sans bruit aléatoire.
const clampPlausible = (v, min = 1) => Math.max(min, Math.round(v));

function poison(value, itemKey, epoch) {
    if (typeof value !== 'number') return value;
    const ep     = epoch || currentEpoch();
    const shift  = (hashInt(String(itemKey) + ep) % 7) - 3;  // [-3, +3]
    return clampPlausible(value + shift);
}

// ─── REFRACT — point d'étranglement unique ────────────────────────────────────
function refract(rows, policy, sessionSeed, epoch) {
    if (!rows) return [];
    if (!Array.isArray(rows)) rows = [rows];
    const ep   = epoch || currentEpoch();
    const seed = sessionSeed || 'anonymous';

    return rows.map((row) => {
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            const pol = policy ? policy[key] : undefined;
            switch (pol) {
                case 'actionable':
                    out[key] = value;
                    break;
                case 'cosmetic':
                    out[key] = watermark(value, seed, key);
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
}

module.exports = {
    refract,
    watermark,
    watermarkText,
    watermarkNumber,
    poison,
    currentEpoch,
    hashInt,
};
