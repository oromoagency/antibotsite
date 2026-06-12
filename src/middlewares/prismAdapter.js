/**
 * prismAdapter.js
 * Pont entre le pipeline Prisme Causal (req.visitor) et les helpers de voie/suspicion.
 * Source de vérité unique : req.visitor — aucun ancien token lu ici.
 */

const { frictionMs } = require('../../prism-sdk/src/server/suspicion');

const chooseLane = (canRender) => (canRender ? 'rich' : 'accessible');

const delay = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Suspicion depuis la session Prisme Causal — calculée par causalOrchestrator
const getSuspicion = (req) => {
    if (typeof req.visitor?.suspicion === 'number') return req.visitor.suspicion;
    return 0.5;
};

// Seed interne de session — opaque, jamais exposé tel quel au client
const getSessionSeed = (req) => {
    if (req.visitor?.internalSeed) return req.visitor.internalSeed;
    return 'anon-' + (req.ip || 'unknown');
};

const getLane = (req) => {
    const reality = req.visitor?.prisme?.reality;
    if (reality === 'blocked')  return 'blocked';
    if (reality === 'decoy')    return 'accessible';
    return chooseLane(true);
};

module.exports = { chooseLane, delay, getSuspicion, getSessionSeed, getLane, frictionMs };
