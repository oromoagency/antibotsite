const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');

// Persistance sur disque — survit aux redémarrages de process dans la même instance Render.
// En production multi-instance : remplacer par Redis (TTL 30j).
const BLACKLIST_PATH = path.join(__dirname, '../../../data/honeypot-blacklist.json');

const blacklistedSeeds = new Set();
const blacklistedIps   = new Set();

// Charge la blacklist depuis le disque au démarrage du process
;(function loadBlacklist() {
    try {
        if (fs.existsSync(BLACKLIST_PATH)) {
            const raw = JSON.parse(fs.readFileSync(BLACKLIST_PATH, 'utf8'));
            (raw.seeds || []).forEach(s => blacklistedSeeds.add(s));
            (raw.ips   || []).forEach(ip => blacklistedIps.add(ip));
            console.log(`[HONEYPOT] Blacklist chargée : ${blacklistedSeeds.size} seeds, ${blacklistedIps.size} IPs`);
        }
    } catch (_) {}
})();

function saveBlacklist() {
    try {
        fs.mkdirSync(path.dirname(BLACKLIST_PATH), { recursive: true });
        fs.writeFileSync(BLACKLIST_PATH, JSON.stringify({
            updatedAt: new Date().toISOString(),
            seeds: [...blacklistedSeeds],
            ips:   [...blacklistedIps],
        }, null, 2));
    } catch (e) {
        console.error('[HONEYPOT] Erreur d\'écriture blacklist:', e.message);
    }
}

function generateHoneypotField(seed) {
    return crypto.createHash('md5').update(seed + '_ghost').digest('hex').slice(0, 10);
}

/**
 * Injecte des champs pièges et des URLs fantômes dans une réponse JSON.
 * Ces champs ne doivent JAMAIS être rendus par le vrai UI.
 */
function injectHoneypot(data, seed) {
    if (!data) return data;

    if (Array.isArray(data)) {
        const trapped = [...data];
        if (trapped.length > 0 && typeof trapped[0] === 'object') {
            trapped[0] = { ...trapped[0], __ghost_rank: generateHoneypotField(seed) };
        }
        return trapped;
    }

    if (typeof data === 'object') {
        return {
            ...data,
            __ghost_rank: generateHoneypotField(seed),
            __trap_api: `/api/__internal/v2/stats/item-${crypto.createHash('md5').update(seed).digest('hex').slice(0, 6)}`,
        };
    }

    return data;
}

/**
 * Middleware piège : répond avec du bait, blackliste le visiteur.
 * Ne retourne JAMAIS 403 — le bot doit croire qu'il a réussi.
 */
function honeypotTrapMiddleware(req, res) {
    const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
    // Identifie la session via le cookie de tracking principal
    const sid = req.cookies?._nx_session || req.cookies?.nx_sess || req.headers['x-prism-seed'];

    if (sid) {
        blacklistedSeeds.add(sid);
        console.warn(`[HONEYPOT] Piège déclenché — session: ${sid.slice(0, 12)}… IP: ${ip}`);
    }
    // Toujours logger l'IP même sans session identifiée
    blacklistedIps.add(ip);
    console.warn(`[HONEYPOT] Piège déclenché — IP: ${ip} UA: ${(req.headers['user-agent'] || '').slice(0, 60)}`);

    // Persistance asynchrone (ne pas bloquer la réponse)
    setImmediate(saveBlacklist);

    // Données leurres — aléatoires à chaque appel pour brouiller le scraper
    res.status(200).json({
        success: true,
        views:   Math.floor(Math.random() * 1000),
        status:  'synced',
    });
}

/**
 * Vérifie si une session ou IP est blacklistée (à utiliser dans requireHumanApi si nécessaire).
 */
function isBlacklisted(seedOrIp) {
    return blacklistedSeeds.has(seedOrIp) || blacklistedIps.has(seedOrIp);
}

function getBlacklistStats() {
    return { seeds: blacklistedSeeds.size, ips: blacklistedIps.size };
}

module.exports = {
    injectHoneypot,
    honeypotTrapMiddleware,
    isBlacklisted,
    getBlacklistStats,
};
