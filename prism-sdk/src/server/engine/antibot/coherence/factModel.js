/**
 * factModel.js
 * Structure d'un Fait (Fact) pour le graphe de cohérence.
 */

const crypto = require('crypto');

function createFact(sessionId, type, name, value, source = 'server', confidence = 'high') {
    return {
        id: 'fact_' + crypto.randomBytes(16).toString('hex'),
        sessionId,
        type,         // network, request, api, navigation, environment, behavior
        name,         // ex: 'api_call', 'user_agent_seen'
        value,        // object
        confidence,   // low, medium, high
        source,       // server ou client
        createdAt: Date.now()
    };
}

module.exports = {
    createFact
};
