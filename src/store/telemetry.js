// Store des empreintes de télémétrie biométrique déjà soumises — anti-rejeu.
//
// Deux soumissions HUMAINES ne peuvent jamais porter la même séquence : chaque
// point souris contient un performance.now() à la microseconde. Une empreinte
// identique re-soumise = la même télémétrie enregistrée puis rejouée (ferme de
// bots, « schémas de requêtes identiques » du rapport #3).
// TTL 2 h : aligné sur la durée de session — au-delà, l'empreinte expire.

const seen = new Map(); // hash -> timestamp d'expiration (ms)
const TELEMETRY_TTL_MS = 2 * 60 * 60 * 1000;

const wasSeen = (hash) => {
    const exp = seen.get(hash);
    if (!exp) return false;
    if (Date.now() > exp) { seen.delete(hash); return false; } // expiration paresseuse
    return true;
};

const record = (hash) => { seen.set(hash, Date.now() + TELEMETRY_TTL_MS); };

const clear = () => seen.clear(); // pour les tests

module.exports = { wasSeen, record, clear, TELEMETRY_TTL_MS };
