const express = require('express');
const path    = require('path');
const router  = express.Router();
const L7_session    = require('../layers/L7_session');
const visitorTracker = require('../middlewares/visitorTracker');

const VIEWS_ROOT = path.join(__dirname, '../views');

// Middleware de tracking sur toutes les pages publiques
router.use(visitorTracker);

// --- Pages publiques (sans antibot) ---
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

// --- Application protégée (passe par l'antibot) ---
router.get('/app', (req, res) => {
    const result = L7_session.verifyToken(req.cookies['human_auth_token']);
    if (!result.valid) {
        console.log(`[L7_SESSION] Session absente ou expirée. IP: ${req.ip}`);
        res.clearCookie('human_auth_token');
        return res.sendFile('gateway.html', { root: VIEWS_ROOT });
    }
    console.log(`[L7_SESSION] Utilisateur validé (score: ${result.data.trustScore}). IP: ${req.ip}`);
    res.sendFile('protected_app.html', { root: VIEWS_ROOT });
});

module.exports = router;
