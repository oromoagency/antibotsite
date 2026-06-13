const express = require('express');
const path    = require('path');
const router  = express.Router();
const L7_session    = require('../layers/L7_session');
const L2_access     = require('../layers/L2_access');
const visitorTracker = require('../middlewares/visitorTracker');

// UAs qui se déclarent crawler sans vérification rDNS — Zero Bot : 403 immédiat.
// Ces patterns ne bloquent jamais un humain normal (aucun vrai browser ne les envoie).
const DECLARED_BOT_UA = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|gptbot|ccbot|anthropic-ai|perplexitybot|bytespider|ahrefsbot|semrushbot|dotbot|rogerbot|exabot|mj12bot/i;

const VIEWS_ROOT = path.join(__dirname, '../views');

// Middleware de tracking (s'applique à tous, y compris les bots sur la gateway)
router.use(visitorTracker);

// --- LE BOUCLIER (GATEWAY ABSOLUE) ---
// Architecture Prisme : plus de porte dure.
// Les bots déclaratifs (UA Googlebot, curl, GPTBot…) ne sont plus redirigés vers Google.
// Ils reçoivent la voie accessible : contenu réel, filigranée + empoisonné + tracé.
// → Un bot qui se déclare honnêtement est traçable par son sessionSeed.
// → Un humain utilisant curl (dev) n'est jamais bloqué.
// → La porte Google disparaît : elle ne servait qu'à cacher, pas à défendre.
const requireHuman = (req, res, next) => {
    // Exclure le dashboard admin du test PoW
    if (req.path.startsWith('/admin')) return next();

    // Crawlers déclaratifs : 403 immédiat (Zero Bot Mode).
    // Ils ne peuvent pas passer le PoW — inutile de leur servir la gateway.
    // Un dev qui teste avec curl ne sera pas bloqué ici (curl n'est pas dans DECLARED_BOT_UA).
    const ua = req.headers['user-agent'] || '';
    if (DECLARED_BOT_UA.test(ua)) {
        return res.status(403).json({ error: 'bot_access_restricted' });
    }

    // ZÉRO CONFIANCE ABSOLUE : La "Voie Accessible" a été retirée à la demande de l'administrateur.
    // Un bot qui se déclare honnête (Googlebot, curl, etc.) ne reçoit plus aucun traitement de faveur.
    // Il devra passer le test de PoW et de Biométrie. Puisqu'il en est incapable, il sera bloqué.

    const ip = req.ip || '';
    const visitor = req.visitorId ? require('../store/visitors').getVisitor(req.visitorId) : null;
    const asn = visitor ? visitor.asn : null;
    if (L2_access.isWhitelisted(ip, asn)) {
        console.log(`[WHITELIST] Passage direct pour IP whitelistée: ${ip}`);
        return next();
    }

    const result = L7_session.verifyToken(req.cookies['human_auth_token']);
    if (!result.valid) {
        console.log(`[L7_SESSION] Session absente/expirée pour ${req.path}. IP: ${req.ip}`);
        res.clearCookie('human_auth_token');
        return res.sendFile('gateway.html', { root: VIEWS_ROOT });
    }
    
    // Si c'est un humain valide, on le laisse passer vers le vrai site
    next();
};

// L'Antibot (Gateway) est maintenant ACTIF en production !
router.use(requireHuman);

// --- Vrai contenu du site (invisible pour les bots) ---
router.get('/', (req, res) => {
    res.sendFile('landing.html', { root: VIEWS_ROOT });
});

router.get('/login', (req, res) => {
    res.sendFile('login.html', { root: VIEWS_ROOT });
});

router.get('/register', (req, res) => {
    res.sendFile('register.html', { root: VIEWS_ROOT });
});

router.get('/docs', (req, res) => {
    res.sendFile('docs.html', { root: VIEWS_ROOT });
});

router.get('/pricing', (req, res) => {
    res.sendFile('pricing.html', { root: VIEWS_ROOT });
});

// --- Tableau de bord admin ---
router.get('/admin', (req, res) => {
    res.sendFile('admin.html', { root: VIEWS_ROOT });
});

// --- Application protégée ---
router.get('/app', (req, res) => {
    res.sendFile('protected_app.html', { root: VIEWS_ROOT });
});

module.exports = router;
