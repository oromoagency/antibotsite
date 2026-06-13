const express = require('express');
const path    = require('path');
const router  = express.Router();
const VIEWS_ROOT = path.join(__dirname, '../views');

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
