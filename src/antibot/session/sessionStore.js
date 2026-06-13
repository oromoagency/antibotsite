/**
 * sessionStore.js
 * MVP: Stockage en RAM (Map) des sessions opaques.
 */

const { createSession } = require('./sessionModel');

// Map globale pour stocker les sessions. 
// Clé: session.id, Valeur: objet session
const store = new Map();

// TTL de 4 heures
const TTL_MS = 4 * 60 * 60 * 1000;

function getSession(sessionId) {
    const session = store.get(sessionId);
    if (!session) return null;

    if (Date.now() - session.lastSeenAt > TTL_MS) {
        store.delete(sessionId);
        return null;
    }

    session.lastSeenAt = Date.now();
    return session;
}

function initializeSession(id) {
    const session = createSession(id);
    store.set(session.id, session);
    return session;
}

function updateSession(session) {
    if (store.has(session.id)) {
        session.lastSeenAt = Date.now();
        store.set(session.id, session);
    }
}

// Nettoyage periodique pour eviter la fuite de memoire
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of store.entries()) {
        if (now - session.lastSeenAt > TTL_MS) {
            store.delete(id);
        }
    }
}, 15 * 60 * 1000); // Toutes les 15 mins

module.exports = {
    getSession,
    initializeSession,
    updateSession
};
