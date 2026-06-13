/**
 * attachDecision.js
 * Attache la décision de l'orchestrateur à la session.
 * Ne bloque JAMAIS les routes publiques (challenge, assets, healthcheck).
 */

const { decideReality } = require('../policy/causalOrchestrator');
const { updateSession }  = require('../session/sessionStore');
const { isPublicPath }   = require('../core/prismeCore');

const attachDecision = (req, res, next) => {
    if (!req.visitor) return next();

    // Les routes publiques ne déclenchent pas de blocage — un bot sur /api/challenge-config
    // doit pouvoir recevoir le défi, sinon il ne peut jamais passer.
    if (isPublicPath(req.path, {})) return next();

    const newReality = decideReality(req.visitor);

    if (req.visitor.prisme.reality !== newReality) {
        req.visitor.prisme.reality     = newReality;
        req.visitor.prisme.updatedAt   = Date.now();
        updateSession(req.visitor);
    }

    if (newReality === 'blocked') {
        return res.status(403).json({
            error:   'access_restricted',
            message: 'Access restricted by policy.'
        });
    }

    next();
};

module.exports = attachDecision;
