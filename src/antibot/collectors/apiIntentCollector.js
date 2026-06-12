/**
 * apiIntentCollector.js
 * Identifie l'intention derrière un appel API (sensible vs public).
 */

const { createFact } = require('../coherence/factModel');

const SENSITIVE_ENDPOINTS = [
    '/api/prism/demo',
    '/api/demo/v1/users',
    '/api/demo/v1/metrics'
];

function collect(req, session) {
    if (!session) return;
    
    // On traque seulement si ça commence par /api/
    if (!req.path.startsWith('/api/')) return;

    const isSensitive = SENSITIVE_ENDPOINTS.includes(req.path);
    
    if (isSensitive) {
        session.counters.sensitiveApiCalls++;
    } else {
        session.counters.requests++;
    }

    session.facts.push(createFact(
        session.id,
        'api',
        'api_call',
        {
            path: req.path,
            method: req.method,
            isSensitive
        }
    ));

    // Marqueur pratique pour les étapes suivantes (contradictionEngine)
    req.isSensitiveApi = isSensitive;
}

module.exports = {
    collect
};
