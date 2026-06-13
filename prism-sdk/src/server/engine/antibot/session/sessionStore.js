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

// Liste des sessions actives (non expirées) — utilisée par l'outil admin de décodage
// de watermark de capture pour relier un id décodé à une session vivante.
function listSessions() {
    const now = Date.now();
    const out = [];
    for (const session of store.values()) {
        if (now - session.lastSeenAt <= TTL_MS) out.push(session);
    }
    return out;
}

// Nettoyage periodique pour eviter la fuite de memoire
const _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of store.entries()) {
        if (now - session.lastSeenAt > TTL_MS) {
            store.delete(id);
        }
    }
}, 15 * 60 * 1000); // Toutes les 15 mins
// Timer de housekeeping : ne doit pas empêcher l'app hôte / les tests de sortir.
if (_cleanupTimer.unref) _cleanupTimer.unref();

module.exports = {
    getSession,
    initializeSession,
    updateSession,
    listSessions
};
