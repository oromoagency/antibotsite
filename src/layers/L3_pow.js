// Couche 3 — Proof of Work memory-hard (Argon2id) & anti-rejeu
//
// Pourquoi Argon2id et non SHA-256 ?
//   SHA-256 est parallélisable à l'infini : un GPU à 10 000 cœurs résout le
//   PoW en quelques millisecondes. Argon2id exige un COÛT EN RAM fixe par
//   tentative (MEM_COST kB) : même GPU ne peut pas paralléliser davantage que
//   sa RAM vidéo totale divisée par MEM_COST. Résultat : le GPU farm n'a plus
//   aucun avantage sur un humain en navigateur WebAssembly.
//
// Paramètres choisis (équilibre mobile bas de gamme / sécurité) :
//   MEM_COST    = 4096 kB (4 MB) par tentative — suffisant pour annuler le GPU
//   TIME_COST   = 2 passages — double la résistance au time-memory trade-off
//   PARALLELISM = 1 — le navigateur mine en mono-thread (WebWorker) ; côté
//                 serveur on valide aussi en mono-thread (argon2.verify)
//   HASH_LENGTH = 32 octets — longueur standard, cohérente avec SHA-256 avant
//
// Sécurité anti-rejeu :
//   Nonce (fourni par le serveur, aléatoire 32 octets hex) : empêche le
//   pré-calcul — un attaquant ne peut pas calculer à l'avance sans connaître
//   le nonce. Consommé en L7 (usedNonces.add) après validation.
//   Télémétrie : deux humains ne produisent JAMAIS la même séquence biométrique
//   (performance.now() à la microseconde). Hash identique = enregistré-rejoué.

const argon2 = require('argon2');
const config  = require('../config');
const posture  = require('../policy/posture');
const { usedNonces } = require('../store/nonces');
const telemetry = require('../store/telemetry');
const crypto  = require('crypto-js');

// Paramètres Argon2id — doivent correspondre exactement côté client (WASM).
const ARGON2_PARAMS = {
    MEM_COST:    4096,  // kB de RAM par tentative (annule le GPU farm)
    TIME_COST:   2,     // itérations (résistance time-memory trade-off)
    PARALLELISM: 1,     // mono-thread navigateur
    HASH_LENGTH: 32,    // octets de sortie
};

// GPU farm : résolution trop rapide même pour Argon2 WASM en environnement natif.
// Sur le hardware le plus rapide (M3 Mac, argon2 natif) avec MEM=4096/TIME=2 :
// ~50 ms. Le navigateur (WASM + overhead) dépasse toujours 200 ms.
const GPU_FARM_PENALTY   = -25;
const MIN_HUMAN_POW_MS   = 200;

const TEMPORAL_ANOMALY_PENALTY  = -30;  // > 60 s = timestamp pré-calculé
const REPLAYED_TELEMETRY_PENALTY = -80; // séquence biométrique rejouée (enregistrement)

// Génère un nonce serveur 32 octets hex — à appeler depuis la route
// GET /api/challenge-config et à renvoyer au client avec la difficulté.
// Le client l'inclut dans l'input Argon2 : impossible de pré-calculer sans lui.
const generateNonce = () => require('crypto').randomBytes(32).toString('hex');

// Retourne { fatal, score, reasons, noStrike? }
const analyze = async ({ nonce, timestamp, fingerprint, argon2Hash, mouseTrajectory, keystrokes }) => {
    if (!nonce || !timestamp || !fingerprint || !argon2Hash) {
        return { fatal: true, score: 0, reasons: ['Payload invalide'] };
    }

    if (usedNonces.has(nonce)) {
        return { fatal: true, score: 0, reasons: ['Nonce déjà utilisé (replay)'] };
    }

    // Timestamp DANS LE FUTUR au-delà d'une petite tolérance d'horloge = FATAL.
    // Un attaquant qui poste un timestamp futur rendrait timeTaken négatif et
    // annulerait la pénalité d'âge (rejeu d'un PoW pré-calculé).
    const FUTURE_SKEW_TOLERANCE_MS = 5000;
    const timeTaken = Date.now() - timestamp;
    if (timeTaken < -FUTURE_SKEW_TOLERANCE_MS) {
        return { fatal: true, score: 0, reasons: ['Timestamp dans le futur (horloge forgée — PoW pré-calculé)'] };
    }

    // Input Argon2 : même construction côté client et serveur.
    // On inclut le nonce (fourni par le serveur) pour l'anti-pré-calcul.
    const input = timestamp.toString() + JSON.stringify(fingerprint) + nonce;

    // Vérification Argon2id — argon2.verify() relit les paramètres depuis le
    // hash encodé (format $argon2id$v=19$m=...,t=...,p=...$...) : aucun risque
    // de désynchronisation des paramètres serveur/client.
    let hashValid = false;
    try {
        hashValid = await argon2.verify(argon2Hash, input);
    } catch (e) {
        return { fatal: true, score: 0, reasons: ['Hash Argon2 invalide ou malformé'] };
    }

    if (!hashValid) {
        // Hash valide à la difficulté de BASE mais pas à l'exigence courante ?
        // (Cas : client resté longtemps pendant une escalade de posture.)
        // Argon2id encode les paramètres dans le hash → un hash à params inférieurs
        // est simplement rejeté par verify(). On ne peut donc pas distinguer ici
        // "mauvais hash" de "difficulté périmée". On rejette proprement sans strike
        // si la posture a changé (noStrike) — le client recharge et re-mine.
        if (posture.currentDifficulty() > config.CHALLENGE_DIFFICULTY) {
            return { fatal: true, noStrike: true, score: 0, reasons: ['PoW à difficulté périmée (escalade de posture pendant le minage)'] };
        }
        return { fatal: true, score: 0, reasons: ['Hash Argon2 invalide'] };
    }

    let score = 0;
    const reasons = [];

    // GPU farm : résolution trop rapide pour du WASM navigateur.
    if (timeTaken >= 0 && timeTaken < MIN_HUMAN_POW_MS) {
        score += GPU_FARM_PENALTY;
        reasons.push(`PoW résolu en ${timeTaken}ms (vitesse native/GPU — incompatible avec Argon2 WASM navigateur)`);
    }

    // Anomalie temporelle : mobile lent toléré jusqu'à 60 s.
    if (timeTaken > 60000) {
        score += TEMPORAL_ANOMALY_PENALTY;
        reasons.push('Anomalie temporelle (> 60 s — timestamp pré-calculé ou décalage horloge)');
    }

    // Rejeu de télémétrie biométrique.
    if (Array.isArray(mouseTrajectory) && mouseTrajectory.length >= 2) {
        const teleHash = crypto.SHA256(JSON.stringify({ m: mouseTrajectory, k: keystrokes || [] })).toString();
        if (telemetry.wasSeen(teleHash)) {
            score += REPLAYED_TELEMETRY_PENALTY;
            reasons.push('Télémétrie biométrique rejouée (séquence identique déjà soumise)');
        } else {
            telemetry.record(teleHash);
        }
    }

    return { fatal: false, score, reasons };
};

module.exports = { analyze, generateNonce, ARGON2_PARAMS, REPLAYED_TELEMETRY_PENALTY };
