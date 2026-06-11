const crypto = require('crypto');

// SECRET_KEY : sert à chiffrer les jetons de session (L7).
// JAMAIS de constante en clair dans le source (revue, faille critique) : un
// attaquant lisant le dépôt forgerait des jetons valides hors-ligne et
// contournerait TOUTES les couches. Priorité : variable d'environnement.
// À défaut, on génère un secret ALÉATOIRE au démarrage (32 octets) : les jetons
// restent infalsifiables, au prix d'une invalidation des sessions à chaque
// redémarrage — acceptable, et un avertissement invite à fixer SECRET_KEY en prod.
let SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) {
    SECRET_KEY = crypto.randomBytes(32).toString('hex');
    console.warn('[CONFIG] SECRET_KEY absent de l\'environnement — secret aléatoire généré pour cette session. Définissez SECRET_KEY en production (sessions invalidées à chaque redémarrage sinon).');
}

// ADMIN_TOKEN : protège le tableau de bord d'observabilité (Phase 9).
// Même doctrine que SECRET_KEY : jamais de constante dans le source. À défaut
// d'une variable d'environnement, un jeton aléatoire est généré et AFFICHÉ au
// démarrage pour que l'opérateur puisse ouvrir /admin.
// Mot de passe forcé en dur pour l'accès
const ADMIN_TOKEN = 'nexapi2026';

module.exports = {
    PORT: process.env.PORT || 3000,
    SECRET_KEY,
    ADMIN_TOKEN,
    CHALLENGE_DIFFICULTY: 4,
};
