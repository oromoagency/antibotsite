// Couche 7 — Session
// Spécialité : création et vérification des tokens de session chiffrés

const crypto = require('crypto-js');
const config = require('../config');

const SESSION_DURATION_MS = 1000 * 60 * 60 * 2; // 2 heures

const createToken = (ip, fingerprint, trustScore) => {
    const tokenData = {
        ip,
        exp: Date.now() + SESSION_DURATION_MS,
        fingerprintHash: crypto.SHA256(JSON.stringify(fingerprint)).toString(),
        trustScore,
    };
    return crypto.AES.encrypt(JSON.stringify(tokenData), config.SECRET_KEY).toString();
};

// Retourne { valid, data }
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
