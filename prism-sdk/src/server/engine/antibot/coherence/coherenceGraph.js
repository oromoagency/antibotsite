/**
 * coherenceGraph.js
 * Applique les règles de contradiction sur la session.
 */

const { RULES } = require('./contradictionRules');

function evaluateSession(session) {
    const newContradictions = [];

    // On évalue toutes les règles
    for (const rule of RULES) {
        // Vérifie si la contradiction existe déjà pour ne pas dupliquer
        const exists = session.coherence.contradictions.find(c => c.ruleId === rule.id);
        if (exists) continue;

        const result = rule.evaluate(session);
        if (result) {
            newContradictions.push(result);
            session.coherence.contradictions.push(result);
        }
    }

    // Recalcul du niveau de cohérence global
    if (session.coherence.contradictions.length === 0) {
        if (session.facts.length > 5) {
            session.coherence.level = 'sufficient';
        } else {
            session.coherence.level = 'unknown'; // Pas encore assez de données
        }
    } else {
        session.coherence.level = 'poor';
    }

    return newContradictions;
}

module.exports = {
    evaluateSession
};
