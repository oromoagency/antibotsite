const crypto = require('crypto');

// Map to store blacklisted seeds in memory (use Redis in prod)
const blacklistedSeeds = new Set();

/**
 * Generates a deterministic ghost field value based on the seed
 */
function generateHoneypotField(seed) {
    return crypto.createHash('md5').update(seed + '_ghost').digest('hex').slice(0, 10);
}

/**
 * Injects honeypot fields and trap URLs into a JSON response payload.
 * These fields should NEVER be rendered by the UI.
 * 
 * @param {Object|Array} data - The original refracted data
 * @param {string} seed - The session seed
 * @returns {Object|Array} The trapped data
 */
function injectHoneypot(data, seed) {
    if (!data) return data;
    
    // Si c'est un tableau, on ajoute l'endpoint fantôme à la racine 
    // et un champ fantôme dans le premier élément (si dispo)
    if (Array.isArray(data)) {
        const trapped = [...data];
        if (trapped.length > 0 && typeof trapped[0] === 'object') {
            trapped[0] = { ...trapped[0], __ghost_rank: generateHoneypotField(seed) };
        }
        // Attaching to the array object itself (might be lost in JSON stringify depending on context,
        // so we often wrap it in an object like { data: trapped, __trap_api: ... })
        return trapped;
    }

    // Si c'est un objet
    if (typeof data === 'object') {
        return {
            ...data,
            __ghost_rank: generateHoneypotField(seed),
            __trap_api: `/api/__internal/v2/stats/item-${crypto.createHash('md5').update(seed).digest('hex').slice(0,6)}`
        };
    }

    return data;
}

/**
 * Express Middleware to handle trap URL hits.
 * If a bot calls this route, their seed is instantly blacklisted.
 */
function honeypotTrapMiddleware(req, res) {
    // Supposons que le seed est dans les cookies
    const seed = req.cookies?.prism_seed || req.headers['x-prism-seed'];
    
    if (seed) {
        console.warn(`[PRISM HONEYPOT] Bot detected! Seed ${seed} triggered the trap.`);
        blacklistedSeeds.add(seed);
    }

    // NEVER return 403. Return a fake success to keep the bot happy but poisoned.
    res.status(200).json({ 
        success: true, 
        views: Math.floor(Math.random() * 1000),
        status: "synced"
    });
}

/**
 * Check if a seed is blacklisted.
 */
function isBlacklisted(seed) {
    return blacklistedSeeds.has(seed);
}

module.exports = {
    injectHoneypot,
    honeypotTrapMiddleware,
    isBlacklisted
};
