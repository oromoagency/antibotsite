const crypto = require('crypto');

/**
 * Scalaire de Suspicion — Architecture Prisme
 * Convertit les signaux en une chaleur (0 à 1)
 */

const MAX_RAW_DELAY_MS  = 8000;
const HUMAN_SAFE_CAP_MS = 600;

function toSuspicion(score) {
    return Math.max(0, Math.min(1, (100 - Math.max(0, score)) / 100));
}

function frictionMs(suspicion) {
    return Math.min(suspicion ** 3 * MAX_RAW_DELAY_MS, HUMAN_SAFE_CAP_MS);
}

/**
 * Calcule la chaleur basée sur les signaux comportementaux (entropie) et réseau
 * @param {Object} signals - { entropy: number, requestFrequency: number }
 * @returns {number} heat (0.0 to 1.0)
 */
function computeHeat(signals) {
    const entropy = signals.entropy || 0;
    const reqFreq = signals.requestFrequency || 1;

    // Seuil arbitraire : un humain a une entropie > 3.0 (distrib Gamma riche)
    // Un bot régulier a une entropie basse.
    const entropyScore = entropy < 3.0 ? 0.8 : 0.1;
    
    // Fréquence : > 10 requêtes par seconde = très suspect
    const freqScore = reqFreq > 10 ? 0.9 : 0.1;

    // Pondération
    return Math.min(1, (entropyScore * 0.6) + (freqScore * 0.4));
}

module.exports = {
    toSuspicion,
    frictionMs,
    computeHeat
};
