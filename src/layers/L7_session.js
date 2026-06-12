// Couche 7 — Session
// Spécialité : création et vérification des tokens de session chiffrés (AES-256)
//
// Architecture Prisme : le token est la SOURCE DE VÉRITÉ de la suspicion.
// Le store RAM (visitors.js) est complémentaire mais volatile — Render redémarre
// et la RAM est purgée. La suspicion et le sessionSeed doivent survivre dans le cookie
// chiffré pour que la réfraction reste cohérente pendant toute la durée de session.

const crypto = require('crypto-js');
const config = require('../config');

const SESSION_DURATION_MS = 1000 * 60 * 60 * 2; // 2 heures

// Crée un token AES-256 contenant ip, empreinte, trustScore, suspicion et sessionSeed.
// suspicion   : scalaire [0.0, 1.0] — source de vérité pour la réfraction (prism/suspicion.js)
// sessionSeed : empreinte cryptographique de la session — source de vérité pour le watermark
const createToken = (ip, fingerprint, trustScore, suspicion, sessionSeed) => {
    const tokenData = {
        ip,
        exp:             Date.now() + SESSION_DURATION_MS,
        fingerprintHash: crypto.SHA256(JSON.stringify(fingerprint)).toString(),
        trustScore,
        // Architecture Prisme — persistés dans le cookie :
        suspicion:   typeof suspicion === 'number'   ? suspicion   : 0.5,
        sessionSeed: typeof sessionSeed === 'string' ? sessionSeed : 'anonymous',
    };
    return crypto.AES.encrypt(JSON.stringify(tokenData), config.SECRET_KEY).toString();
};

// Retourne { valid, data }
// data contient désormais : { ip, trustScore, suspicion, sessionSeed, fingerprintHash, exp }
const verifyToken = (token) => {
    if (!token) return { valid: false, data: null };
    try {
        const decryptedBytes = crypto.AES.decrypt(token, config.SECRET_KEY);
        const data = JSON.parse(decryptedBytes.toString(crypto.enc.Utf8));
        if (Date.now() > data.exp) return { valid: false, data: null };
        return { valid: true, data };
    } catch {
        return { valid: false, data: null };
    }
};

module.exports = { createToken, verifyToken, SESSION_DURATION_MS };
