const express = require('express');
const path    = require('path');
const router  = express.Router();
const L7_session    = require('../layers/L7_session');
const L2_access     = require('../layers/L2_access');
const visitorTracker = require('../middlewares/visitorTracker');

const VIEWS_ROOT = path.join(__dirname, '../views');

// Middleware de tracking (s'applique à tous, y compris les bots sur la gateway)
router.use(visitorTracker);

// --- LE BOUCLIER (GATEWAY ABSOLUE) ---
// Aucun bot ne verra le code des pages suivantes s'il ne passe pas ce test.
const requireHuman = (req, res, next) => {
    // Exclure le dashboard admin du test PoW
    if (req.path.startsWith('/admin')) return next();

    // Exclure les IPs/ASNs en whitelist — passage direct sans PoW
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : (req.ip || '');
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
        // On sert la Gateway directement sur l'URL demandée.
        // Si le test réussit, gateway.html rechargera la page et l'utilisateur verra le vrai contenu.
        return res.sendFile('gateway.html', { root: VIEWS_ROOT });
    }
    
    // Si c'est un humain valide, on le laisse passer vers le vrai site
    next();
};

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
