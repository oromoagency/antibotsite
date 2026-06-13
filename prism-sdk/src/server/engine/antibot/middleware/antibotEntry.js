/**
 * antibotEntry.js
 * Middleware point d'entrée de l'antibot.
 * Gère l'identification de la session via token opaque et attache `req.visitor`.
 */

const { getSessionIdFromRequest, setSessionCookie } = require('../session/tokenService');
const { getSession, initializeSession, updateSession } = require('../session/sessionStore');

const antibotEntry = (req, res, next) => {
    // 1. Lire le cookie opaque
    let sessionId = getSessionIdFromRequest(req);
    let session = sessionId ? getSession(sessionId) : null;

    // 2. Si pas de session valide, en créer une nouvelle
    if (!session) {
        session = initializeSession();
        // Le cookie doit être sécurisé
        setSessionCookie(res, session.id);
        
        // Log création de session (Phase 2 - Obsevability)
        console.log(`[SESSION] Nouvelle session opaque générée: ${session.id}`);
    } else {
        // 3. Mettre à jour la date de dernière activité
        updateSession(session);
    }

    // 4. Attacher la session à la requête
    req.visitor = session;

    next();
};

module.exports = antibotEntry;
