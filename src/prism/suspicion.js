// Scalaire de Suspicion — Architecture Prisme
// Convertit les scores bruts des couches (0–100) en vecteur de décision continu.
//
// Règles d'or :
//   1. Aucune porte — toutes les voies sont utilisables par un humain.
//   2. La détection module le coût, elle ne ferme aucune porte.
//   3. Friction plafonnée : un humain "chaud" (VPN, CGNAT) subit au pire 600ms — jamais un refus.

// ─── Scalaire de suspicion ────────────────────────────────────────────────────
// score ∈ [0, 100] → suspicion ∈ [0.0, 1.0]
// score 100 (parfait) → suspicion 0.0 (aucune friction)
// score 0   (bot)     → suspicion 1.0 (friction max, mais jamais refus)
const toSuspicion = (score) => Math.max(0, Math.min(1, (100 - Math.max(0, score)) / 100));

// ─── Friction plafonnée ───────────────────────────────────────────────────────
// Délai côté serveur appliqué AVANT d'envoyer la réponse.
// Courbe exponentielle (suspicion^3) : quasi-nulle pour un humain normal,
// progressive pour un bot, et plafonnée pour ne jamais bloquer un humain chaud.
//
// Valeurs indicatives :
//   suspicion 0.10 (humain)   → ~0ms
//   suspicion 0.45 (douteux)  → ~37ms
//   suspicion 0.80 (bot prob) → ~410ms
//   suspicion 1.00 (ban)      → 600ms (plafond)
const HUMAN_SAFE_CAP_MS = 600; // plafond dur — un humain ne dépasse jamais ça
const MAX_RAW_DELAY_MS  = 8000;

const frictionMs = (suspicion) =>
    Math.min(suspicion ** 3 * MAX_RAW_DELAY_MS, HUMAN_SAFE_CAP_MS);

// ─── Routeur de voies ─────────────────────────────────────────────────────────
// 'rich'       : SPA complète, rendu réel, filigrane léger
// 'accessible' : HTML sémantique, sans JS obligatoire, filigrane + poison complets
//
// Invariant : les DEUX voies servent du contenu utilisable.
//             actionable est exact dans les deux voies.
//             La voie accessible n'est PAS un refus — c'est un vrai contenu dégradé.
const chooseLane = (canRender) => (canRender ? 'rich' : 'accessible');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Extrait la suspicion d'une requête enrichie par le middleware L2 ou L7
const getSuspicion = (req, visitors) => {
    // Priorité 1 : suspicion forcée par L2 (IP bannie)
    if (req.prismaForced) return req.prismaForced.suspicion || 1.0;

    // Priorité 2 : score de la session visiteur (post-PoW)
    const sessionId = req.cookies && req.cookies['_nx_session'];
    if (sessionId && visitors) {
        const v = visitors.getVisitor(sessionId);
        if (v && v.score !== undefined) return toSuspicion(v.score);
    }

    // Priorité 3 : pas de session = suspicion neutre (n'a pas encore fait le PoW)
    return 0.5;
};

const getLane = (req) => {
    if (req.prismaForced && req.prismaForced.lane) return req.prismaForced.lane;
    // Par défaut on considère que le navigateur peut rendre (la gateway a validé)
    return chooseLane(true);
};

module.exports = {
    toSuspicion,
    frictionMs,
    chooseLane,
    delay,
    getSuspicion,
    getLane,
    HUMAN_SAFE_CAP_MS,
    MAX_RAW_DELAY_MS,
};
