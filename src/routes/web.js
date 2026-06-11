const express = require('express');
const path = require('path');
const router = express.Router();
const L7_session = require('../layers/L7_session');

// sendFile SANS `root` applique la politique dotfiles au chemin ABSOLU entier :
// si le projet vit sous un dossier caché (ex. ~/.gemini/...), TOUTES les pages
// répondent 404. Avec `root`, seul le chemin relatif (le nom du fichier) est
// contrôlé — le bug disparaît quel que soit l'emplacement du projet.
const VIEWS_ROOT = path.join(__dirname, '../views');

// Tableau de bord opérateur (Phase 9). La page elle-même ne contient aucun
// secret : les données exigent le jeton (en-tête x-admin-token, cf. API).
router.get('/admin', (req, res) => {
    res.sendFile('admin.html', { root: VIEWS_ROOT });
});

router.get('/', (req, res) => {
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
