const refractor = require('./refractor');
const suspicion = require('./suspicion');
const honeypot = require('./honeypot');
const pow = require('./pow');
const revelation = require('./revelation');

/**
 * Middleware Prisme Express
 * Point d'étranglement qui intercepte les res.json()
 * 
 * @param {Object} policy - La politique de champs (actionable, cosmetic, aggregate)
 */
function prismMiddleware(policy) {
    return (req, res, next) => {
        const originalJson = res.json;
        
        res.json = function(data) {
            // 1. Identifier la session (simplifié)
            const seed = req.cookies?.prism_seed || req.headers['x-prism-seed'] || 'anonymous';
            
            // 2. Vérifier si c'est un bot confirmé (Honeypot)
            if (honeypot.isBlacklisted(seed)) {
                // Poison total : on génère un faux data plausible mais complètement faux
                // Dans une vraie implémentation, on ferait un fuzzing complet de `data`
                return originalJson.call(this, { ...data, _poisoned: true });
            }

            // 3. Réfraction classique (Jitter & Watermark)
            let safeData = refractor.refract(data, policy, seed);

            // 4. Injection du Honeypot pour attraper les futurs bots
            safeData = honeypot.injectHoneypot(safeData, seed);

            // Retourner la donnée protégée
            return originalJson.call(this, safeData);
        };
        next();
    };
}

module.exports = {
    ...refractor,
    ...suspicion,
    ...honeypot,
    ...pow,
    ...revelation,
    prismMiddleware
};
