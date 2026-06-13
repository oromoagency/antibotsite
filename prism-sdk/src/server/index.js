const refractor = require('./refractor');
const honeypot = require('./honeypot');
const suspicion = require('./suspicion');
const pow = require('./pow');
const revelation = require('./revelation');
const { PrismeShield } = require('./engine');

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
            
            // 2. Bot confirmé (honeypot) : poison AGRESSIF + leurre, SANS jamais de
            //    marqueur révélateur. (Bug corrigé : on ajoutait `_poisoned: true`, ce qui
            //    signalait au bot que sa donnée était fausse — auto-sabotage.)
            if (honeypot.isBlacklisted(seed)) {
                const poisoned = refractor.refract(data, policy, seed, undefined, { poisonFactor: 8 });
                return originalJson.call(this, honeypot.injectHoneypot(poisoned, seed));
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
    prismMiddleware,
    PrismeShield,
    store: require('./engine').store,
    sessionStore: require('./engine').sessionStore
};
