// Observabilité (Phase 9) — expose l'état GLOBAL du système à l'opérateur :
// posture de flotte, difficulté PoW courante, statistiques de verdicts,
// raisons dominantes. Lecture seule : aucun levier de décision ici.
//
// Protégé par ADMIN_TOKEN (en-tête x-admin-token), comparaison en temps
// constant — un attaquant ne doit pas pouvoir deviner le jeton octet par
// octet en mesurant la latence.

const crypto = require('crypto');
const config = require('../config');
const posture = require('../policy/posture');
const events  = require('../store/events');
const { getBlacklistStats } = require('../../prism-sdk/src/server/honeypot');

const tokenValid = (supplied) => {
    if (typeof supplied !== 'string' || supplied.length === 0) return false;
    const a = crypto.createHash('sha256').update(supplied).digest();
    const b = crypto.createHash('sha256').update(config.ADMIN_TOKEN).digest();
    return crypto.timingSafeEqual(a, b); // hash → longueurs égales garanties
};

exports.getStats = (req, res) => {
    if (!tokenValid(req.headers['x-admin-token'])) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    posture.evaluate();

    res.json({
        posture:       posture.currentLevel(),
        difficulty:    posture.currentDifficulty(),
        window5min:    events.statsWindow(5 * 60 * 1000),
        lastHour:      events.statsWindow(60 * 60 * 1000),
        eventsStored:  events.size(),
        honeypot:      getBlacklistStats(),
    });
};
