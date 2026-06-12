/**
 * collectRequestFacts.js
 * Middleware qui appelle les collecteurs pour alimenter le graphe de la session.
 */

const networkCollector = require('../collectors/networkCollector');
const apiIntentCollector = require('../collectors/apiIntentCollector');
const { updateSession } = require('../session/sessionStore');

const collectRequestFacts = (req, res, next) => {
    if (!req.visitor) return next();

    if (!Array.isArray(req.visitor.facts)) {
        req.visitor.facts = req.visitor.coherence && Array.isArray(req.visitor.coherence.facts)
            ? req.visitor.coherence.facts
            : [];
    }
    if (req.visitor.coherence && !Array.isArray(req.visitor.coherence.facts)) {
        req.visitor.coherence.facts = req.visitor.facts;
    }

    // Limiter le nombre de faits en mémoire pour ne pas fuiter
    if (req.visitor.facts.length > 500) {
        req.visitor.facts.shift();
    }

    networkCollector.collect(req, req.visitor);
    apiIntentCollector.collect(req, req.visitor);

    updateSession(req.visitor);

    next();
};

module.exports = collectRequestFacts;
