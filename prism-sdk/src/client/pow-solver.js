/**
 * Solveur de Preuve de Travail (PoW) en JavaScript.
 * S'exécute de préférence dans un Web Worker pour ne pas bloquer l'UI principale.
 */

// Simple SHA-256 implementation would go here (or use Web Crypto API)
// For the sake of this SDK, we'll simulate the heavy lifting.
// In a real implementation, you would use crypto.subtle.digest.

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Résout un challenge envoyé par le serveur
 * @param {Object} challenge - { payload: string, difficulty: number }
 * @returns {Promise<number>} Le nonce trouvé
 */
async function solveChallenge(challenge) {
    const { payload, difficulty } = challenge;
    const target = Math.floor(0xffffff / difficulty);
    
    let nonce = 0;
    let found = false;

    // Boucle de minage
    // Note: Dans un vrai SDK, il faudrait des `await new Promise(r => setTimeout(r, 0))`
    // tous les 1000 itérations pour ne pas complètement freeze le thread si on 
    // n'est pas dans un Web Worker.
    while (!found) {
        const hash = await sha256(payload + nonce.toString());
        const prefix = parseInt(hash.slice(0, 6), 16);
        
        if (prefix <= target) {
            found = true;
            return nonce;
        }
        nonce++;
    }
}

module.exports = {
    solveChallenge
};
