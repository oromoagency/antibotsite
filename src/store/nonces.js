// Store des nonces consommés — protection anti-rejeu (replay) du challenge PoW.
const usedNonces = new Set();

module.exports = { usedNonces };
