// Orchestrateur — n'implémente AUCUNE heuristique lui-même.
// Il appelle chaque couche spécialisée dans l'ordre, collecte leurs témoignages
// et délègue la DÉCISION à la politique de verdict (src/policy/verdict.js) :
//   L1 réseau/TLS → L2 accès → L3 PoW → L4 Matériel → L5 Automatisation → L6 Biométrie → L7 Session
//
// Doctrine de décision (rapport bots #3) : un seul indicateur ne suffit jamais.
//   - refus (403, retryable) : score sous le seuil de confiance.
//   - ban (strike escaladé)  : exige EN PLUS une déclaration explicite (UA bot,
//     rejeu PoW) OU la corroboration d'au moins 2 couches indépendantes.

const L1_tls        = require('../layers/L1_tls');
const L2_access     = require('../layers/L2_access');
const L3_pow        = require('../layers/L3_pow');
const { generateNonce } = require('../layers/L3_pow');
const L4_hardware   = require('../layers/L4_hardware');
const L5_automation = require('../layers/L5_automation');
const L6_biometrics = require('../layers/L6_biometrics');
const L7_session    = require('../layers/L7_session');
const telegram      = require('./telegramController');
const visitors      = require('../store/visitors');
const verdict       = require('../policy/verdict');
const posture       = require('../policy/posture');
const reputation    = require('../store/reputation');
const events        = require('../store/events');
const { usedNonces } = require('../store/nonces');

// Phase 9 — intelligence globale : chaque décision est JOURNALISÉE (pure
// observation, aucune heuristique) puis la posture de flotte est réévaluée.
// `ua` optionnel : User-Agent pour le calcul d'entropie Shannon en posture.
const recordOutcome = (ip, verdictLabel, score, witnesses, reasons, ua) => {
    events.record({ ip, verdict: verdictLabel, score, witnesses, reasons, ua });
    posture.evaluate();
};

// Le client demande la difficulté PoW COURANTE juste avant de miner.
// Elle ne révèle rien d'exploitable : connaître la difficulté ne dispense
// pas de payer son coût CPU.
// Cache serveur des nonces actifs : nonce → expiration (Date.now() + 10 min).
// Un client qui recharge la page obtient un nouveau nonce ; l'ancien est
// invalidé après 10 min pour ne pas laisser grossir la map indéfiniment.
const pendingNonces = new Map();
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

exports.getChallengeConfig = (req, res) => {
    posture.evaluate();
    // Génère un nonce serveur unique pour cette session de minage.
    // Le client l'inclut dans l'input Argon2 : impossible de pré-calculer
    // le hash sans connaître ce nonce à l'avance.
    const serverNonce = generateNonce();
    pendingNonces.set(serverNonce, Date.now() + NONCE_TTL_MS);
    // Nettoyage paresseux des nonces expirés.
    for (const [n, exp] of pendingNonces) {
        if (Date.now() > exp) pendingNonces.delete(n);
    }
    res.json({ difficulty: posture.currentDifficulty(), serverNonce });
};

exports.verifyChallenge = async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const {
        nonce, timestamp, fingerprint,
        argon2Hash,
        sensorDesync,
        hardware, automation, vsync,
        mouseTrajectory, keystrokes,
    } = req.body;

    // --- L3 : Proof of Work Argon2id & anti-rejeu (peut être fatal) ---
    // Vérifie que le nonce serveur était bien en attente (anti-forgery).
    const nonceExpiry = pendingNonces.get(nonce);
    if (!nonceExpiry || Date.now() > nonceExpiry) {
        recordOutcome(ip, 'fatal', 0, 0, ['Nonce serveur inconnu ou expiré'], req.headers['user-agent']);
        return res.status(403).json({ success: false, message: 'Vérification échouée.' });
    }
    pendingNonces.delete(nonce); // consommé une seule fois

    const pow = await L3_pow.analyze({ nonce, timestamp, fingerprint, argon2Hash, mouseTrajectory, keystrokes });
    if (pow.fatal) {
        const malformed = pow.reasons[0] === 'Payload invalide';
        // Payload malformé = client cassé possible → pas de ban. PoW faux/rejeu = automatisation.
        // noStrike (Phase 9) : difficulté périmée pendant une escalade de posture —
        // plausible humain resté sur la page, il recharge et re-mine. Pas de strike.
        if (!malformed && !pow.noStrike) reputation.recordStrike(ip);
        recordOutcome(ip, 'fatal', 0, 0, pow.reasons, req.headers['user-agent']);
        console.log(`[L3_POW] Rejeté: ${pow.reasons[0]}. IP: ${ip}`);
        // Message client GÉNÉRIQUE (revue) : ne pas révéler la couche/raison exacte
        // (un attaquant les corrèle pour rétro-concevoir les seuils). Détail en log.
        return res
            .status(malformed ? 400 : 403)
            .json({ success: false, message: malformed ? 'Requête invalide.' : 'Vérification échouée.' });
    }

    // --- L1 : signaux réseau (middleware) + TLS, FUSIONNÉS en UN SEUL témoin ---
    // (revue : L1_network et L1_tls sont deux spécialités de la MÊME couche L1 ;
    //  les passer séparément les compterait pour 2 témoins et violerait la doctrine.)
    const tls = L1_tls.analyze({
        ja4: req.headers['x-ja4'] || (req.socket && req.socket.ja4),
        userAgent: (fingerprint && fingerprint.userAgent) || req.headers['user-agent'],
    });
    const net = req.l1Signals || { score: 0, reasons: [], declarative: false };
    const l1 = {
        score: (net.score || 0) + (tls.score || 0),
        reasons: [...(net.reasons || []), ...(tls.reasons || [])],
        declarative: net.declarative === true,
    };

    // --- L2 : Réputation IP (provenance datacenter + cadence de tentatives) ---
    const acc = L2_access.analyze({ ip, fingerprint });

    // --- L4 : Empreinte matérielle ---
    const hw = L4_hardware.analyze({
        webgl: hardware && hardware.webgl,
        canvas: hardware && hardware.canvas,
        audio: hardware && hardware.audio,
        webgpu: hardware ? hardware.webgpu : undefined,
        sensorDesync, fingerprint,
    });

    // --- L5 : Détection d'automatisation ---
    const auto = L5_automation.analyze({ automation, vsync });

    // --- L6 : Biométrie comportementale ---
    const bio = L6_biometrics.analyze({ mouseTrajectory, keystrokes });

    // --- Verdict : agrégation + règle de corroboration (politique, pas heuristique) ---
    const v = verdict.decide([pow, l1, acc, hw, auto, bio]);

    console.log(`[ORCHESTRATOR] IP: ${ip} | Score: ${v.score} | Témoins: ${v.witnesses} | Raisons: ${v.reasons.join(', ') || 'aucune'}`);

    // --- Mise à jour de la session visiteur (s'il en a une) et envoi Telegram ---
    const sessionId = req.cookies && req.cookies['_nx_session'];
    let visitor = sessionId ? visitors.getVisitor(sessionId) : null;
    
    // S'il n'a pas de session (bot pur qui bloque les cookies), on lui crée une fiche temporaire pour Telegram
    if (!visitor) {
        visitor = visitors.createVisitor({ ip, userAgent: req.headers['user-agent'] || 'unknown' });
    }
    
    visitors.updateVisitor(visitor.id, {
        score: v.score,
        decision: v.allowed ? 'allowed' : (v.ban ? 'blocked' : 'suspect'),
        reasons: v.reasons
    });
    
    // Envoi de la notification Telegram pour TOUT LE MONDE
    telegram.notifySuspect(visitor).catch(() => {});

    if (!v.allowed) {
        if (v.ban) {
            reputation.recordStrike(ip);
            console.log(`[ACCESS_DENIED] Bot corroboré (score ${v.score}, ${v.witnesses} couches${v.declarative ? ', déclaratif' : ''}), strike. IP: ${ip}`);
        } else {
            console.log(`[ACCESS_DENIED] Refus sans ban (score ${v.score}, corroboration insuffisante). IP: ${ip}`);
        }
        recordOutcome(ip, v.ban ? 'ban' : 'block', v.score, v.witnesses, v.reasons, req.headers['user-agent']);
        return res.status(403).json({ success: false, message: 'Vérification échouée.' });
    }

    // --- L7 : Session ---
    usedNonces.add(nonce);
    const token = L7_session.createToken(ip, fingerprint, v.score);
    res.cookie('human_auth_token', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict', // anti-CSRF : le cookie n'accompagne pas les requêtes cross-site
        maxAge: L7_session.SESSION_DURATION_MS,
    });

    recordOutcome(ip, 'pass', v.score, v.witnesses, [], req.headers['user-agent']);
    console.log(`[VALIDATION_PASSED] Score: ${v.score}. IP: ${ip}`);
    res.json({ success: true });
};

exports.recordSilentFeedback = (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;

    // Protection CSRF (revue, faille critique) : sans ce contrôle, un site malveillant
    // pouvait faire POSTer le navigateur d'une VICTIME vers ce piège et faire bannir
    // SON IP (un seul « indicateur » non corroboré → violation directe de la doctrine).
    // On n'accepte le strike que si la requête vient bien de NOTRE origine : un piège
    // n'est légitimement déclenché que par un bot parcourant NOTRE DOM (même origine).
    const origin = req.headers.origin || req.headers.referer || '';
    const host = req.headers.host || '';
    const sameOrigin = origin === '' // requêtes server-to-server / outils : tolérées
        ? true
        : (() => { try { return new URL(origin).host === host; } catch { return false; } })();

    if (!sameOrigin) {
        console.log(`[HONEYPOT] POST cross-origin ignoré (CSRF probable) — origin="${origin}" host="${host}". Pas de strike.`);
        return res.status(403).send('Forbidden.');
    }

    console.log(`[HONEYPOT] Piège déclenché (même origine), strike pour: ${ip}`);
    reputation.recordStrike(ip);
    res.status(403).send('Forbidden.');
};
