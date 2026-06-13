/**
 * prismAdapter.js
 * Pont entre le pipeline Prisme Causal (req.visitor) et les helpers de voie/suspicion.
 * Source de vérité unique : req.visitor — aucun ancien token lu ici.
 */

const { frictionMs } = require('../../prism-sdk');

const chooseLane = (canRender) => (canRender ? 'rich' : 'accessible');

const delay = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Suspicion depuis la session Prisme Causal — calculée par causalOrchestrator
const getSuspicion = (req) => {
    if (typeof req.visitor?.suspicion === 'number') return req.visitor.suspicion;
    return 0.5;
};

// Seed interne de session — opaque, jamais exposé tel quel au client.
// Priorité au seed DURABLE réhydraté depuis le JWT (stable après un redémarrage du
// store RAM) pour que le watermark reste traçable dans le temps ; sinon le secret de
// la session vivante ; sinon un repli anonyme par IP.
const getSessionSeed = (req) => {
    if (req.visitor?.prisme?.sessionSeed) return req.visitor.prisme.sessionSeed;
    if (req.visitor?.internalSeed)        return req.visitor.internalSeed;
    return 'anon-' + (req.ip || 'unknown');
};

const getLane = (req) => {
    const reality = req.visitor?.prisme?.reality;
    if (reality === 'blocked')  return 'blocked';
    if (reality === 'decoy')    return 'accessible';
    return chooseLane(true);
};

module.exports = { chooseLane, delay, getSuspicion, getSessionSeed, getLane, frictionMs };
