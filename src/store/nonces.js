// Store des nonces consommés — protection anti-rejeu (replay) du challenge PoW.
// TTL de 15 min : un nonce valide pendant 10 min (pendingNonces) + 5 min de marge.
// Évite la croissance non bornée du Set sur un serveur longue durée.

const NONCE_TTL_MS = 15 * 60 * 1000;
const usedNoncesMap = new Map(); // nonce -> expiration (ms)

const usedNonces = {
    has(nonce) {
        const exp = usedNoncesMap.get(nonce);
        if (!exp) return false;
        if (Date.now() > exp) { usedNoncesMap.delete(nonce); return false; }
        return true;
    },
    add(nonce) {
        usedNoncesMap.set(nonce, Date.now() + NONCE_TTL_MS);
        // Nettoyage paresseux : purge les entrées expirées à chaque ajout.
        const now = Date.now();
        for (const [n, exp] of usedNoncesMap) {
            if (now > exp) usedNoncesMap.delete(n);
        }
    },
};

module.exports = { usedNonces };
