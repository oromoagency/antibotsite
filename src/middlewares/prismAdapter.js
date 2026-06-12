const L7_session = require('../layers/L7_session');
const { toSuspicion } = require('../../prism-sdk/src/server/suspicion');

// ─── Routeur de voies (Lanes) ─────────────────────────────────────────────────
// 'rich'       : SPA complète, rendu réel, filigrane léger
// 'accessible' : HTML sémantique, sans JS obligatoire, filigrane + poison complets
const chooseLane = (canRender) => (canRender ? 'rich' : 'accessible');

// ─── Helper de délai réseau ───────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Extrait la suspicion d'une requête — ordre de priorité :
//   1. req.prismaForced (IP bannie ou bot déclaratif)
//   2. JWT cookie human_auth_token
//   3. Store RAM visitors.js
//   4. 0.5 — valeur neutre
const getSuspicion = (req, visitors) => {
    // Priorité 1 : suspicion forcée
    if (req.prismaForced) return req.prismaForced.suspicion || 1.0;

    // Priorité 2 : JWT cookie
    const tokenResult = L7_session.verifyToken(req.cookies && req.cookies['human_auth_token']);
    if (tokenResult.valid && typeof tokenResult.data.suspicion === 'number') {
        return tokenResult.data.suspicion;
    }

    // Priorité 3 : store RAM
    const sessionId = req.cookies && req.cookies['_nx_session'];
    if (sessionId && visitors) {
        const v = visitors.getVisitor(sessionId);
        if (v && v.score !== undefined) return toSuspicion(v.score);
    }

    // Priorité 4 : neutre
    return 0.5;
};

// Extrait le sessionSeed — même ordre de priorité
const getSessionSeed = (req, visitors) => {
    if (req.prismaForced) return 'forced-' + (req.ip || 'unknown');

    const tokenResult = L7_session.verifyToken(req.cookies && req.cookies['human_auth_token']);
    if (tokenResult.valid && typeof tokenResult.data.sessionSeed === 'string') {
        return tokenResult.data.sessionSeed;
    }

    const sessionId = req.cookies && req.cookies['_nx_session'];
    if (sessionId && visitors) {
        const v = visitors.getVisitor(sessionId);
        if (v && v.sessionSeed) return v.sessionSeed;
    }

    return 'anonymous-' + (req.ip || 'unknown');
};

const getLane = (req) => {
    if (req.prismaForced && req.prismaForced.lane) return req.prismaForced.lane;
    return chooseLane(true);
};

module.exports = {
    chooseLane,
    delay,
    getSuspicion,
    getSessionSeed,
    getLane
};
