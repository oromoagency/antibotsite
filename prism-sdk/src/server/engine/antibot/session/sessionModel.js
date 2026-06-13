/**
 * sessionModel.js
 * Structure d'une session Prisme Causal
 */

const crypto = require('crypto');

function createSession(id) {
    const facts = [];

    return {
        id: id || 'nx_' + crypto.randomBytes(24).toString('hex'),
        internalSeed: crypto.randomBytes(32).toString('hex'), // Secret serveur
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        humanValidated: false, // Zero Bot Mode: true si passé le gate
        facts,
        coherence: {
            level: "unknown", // unknown, sufficient, poor
            contradictions: [],
            facts
        },
        prisme: {
            reality: "normal",
            updatedAt: Date.now()
        },
        suspicion: 0.1,
        counters: {
            requests: 0,
            sensitiveApiCalls: 0,
            challenges: 0
        },
        ipHistory: [],
        userAgentHistory: []
    };
}

module.exports = {
    createSession
};
