const crypto = require('crypto');

const MAX_DIFFICULTY = 100000;

/**
 * Génère un challenge de Preuve de Travail (PoW) proportionnel à la chaleur.
 * @param {number} heat - La chaleur de la session (0.0 à 1.0)
 * @param {string} seed - Le seed de la session
 * @returns {Object} Le challenge
 */
function generateChallenge(heat, seed) {
    // Plus la chaleur est élevée, plus la difficulté explose de façon exponentielle
    // Humain (0.1) -> difficulté ~100
    // Bot (0.8) -> difficulté ~51200
    const difficulty = Math.max(10, Math.floor(Math.pow(heat, 3) * MAX_DIFFICULTY));
    
    const salt = crypto.randomBytes(8).toString('hex');
    const challengePayload = crypto.createHash('sha256').update(seed + salt).digest('hex');

    return {
        type: 'pow_challenge',
        algorithm: 'sha256_prefix',
        payload: challengePayload,
        difficulty: difficulty
    };
}

/**
 * Vérifie si la solution soumise par le client résout le challenge
 * @param {string} payload - Le payload original du challenge
 * @param {number} difficulty - La difficulté attendue
 * @param {number} nonce - Le nonce trouvé par le client
 * @returns {boolean}
 */
function verifySolution(payload, difficulty, nonce) {
    const hash = crypto.createHash('sha256').update(payload + nonce.toString()).digest('hex');
    
    // Vérification simplifiée de la difficulté : 
    // On convertit les N premiers caractères hex en entier et on vérifie qu'ils sont <= cible
    // C'est une implémentation jouet classique de PoW.
    const target = Math.floor(0xffffff / difficulty);
    const prefix = parseInt(hash.slice(0, 6), 16);
    
    return prefix <= target;
}

module.exports = {
    generateChallenge,
    verifySolution
};
