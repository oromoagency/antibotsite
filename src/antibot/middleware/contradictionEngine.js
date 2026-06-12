/**
 * contradictionEngine.js
 * Middleware qui évalue la cohérence de la session après collecte des faits.
 */

const coherenceGraph = require('../coherence/coherenceGraph');
const { updateSession } = require('../session/sessionStore');

const contradictionEngine = (req, res, next) => {
    if (!req.visitor) return next();

    const newContradictions = coherenceGraph.evaluateSession(req.visitor);

    if (newContradictions.length > 0) {
        console.log(`[PRISME] Contradictions détectées pour session ${req.visitor.id}:`);
        newContradictions.forEach(c => console.log(`  -> [${c.severity}] ${c.title}`));
    }

    updateSession(req.visitor);

    next();
};

module.exports = contradictionEngine;
