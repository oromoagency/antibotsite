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
    const ip = req.ip || 'unknown';
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

    // Préfixe chaque raison d'une couche avec son étiquette [Lx-Nom] pour que
    // les logs, Telegram et le dashboard admin indiquent QUELLE couche a détecté quoi.
    const tag = (result, label) => result
        ? { ...result, reasons: (result.reasons || []).map(r => `[${label}] ${r}`) }
        : result;

    // Résoudre le visiteur AVANT le pipeline pour avoir l'ASN et l'historique IP.
    // (Le lookup est déplacé ici depuis l'aval pour que L2 puisse lire visitor.asn.)
    const sessionId = req.cookies && req.cookies['_nx_session'];
    let visitor = sessionId ? visitors.getVisitor(sessionId) : null;

    // --- L1 : signaux réseau (middleware) + TLS, FUSIONNÉS en UN SEUL témoin ---
    // (revue : L1_network et L1_tls sont deux spécialités de la MÊME couche L1 ;
    //  les passer séparément les compterait pour 2 témoins et violerait la doctrine.)
    const tls = L1_tls.analyze({
        ja4: req.headers['x-ja4'] || (req.socket && req.socket.ja4),
        userAgent: (fingerprint && fingerprint.userAgent) || req.headers['user-agent'],
    });
    const net = req.l1Signals || { score: 0, reasons: [], declarative: false };
    const l1 = tag({
        score: (net.score || 0) + (tls.score || 0),
        reasons: [...(net.reasons || []), ...(tls.reasons || [])],
        declarative: net.declarative === true,
    }, 'L1-Réseau');

    // --- L2 : Réputation IP (datacenter, ASN, suspect, vélocité) ---
    const acc = tag(L2_access.analyze({ ip, fingerprint, asn: visitor ? visitor.asn : null }), 'L2-Accès');

    // --- L3 : Proof of Work (déjà évalué, on le tague pour cohérence) ---
    const powTagged = tag(pow, 'L3-PoW');

    // --- L4 : Empreinte matérielle ---
    const hwRaw = L4_hardware.analyze({
        webgl: hardware && hardware.webgl,
        canvas: hardware && hardware.canvas,
        audio: hardware && hardware.audio,
        webgpu: hardware ? hardware.webgpu : undefined,
        sensorDesync, fingerprint,
        battery: visitor ? visitor.battery : null,
    });

    // --- L5 : Détection d'automatisation ---
    const autoRaw = L5_automation.analyze({ automation, vsync });

    // --- Règle combinée Camoufox + CDP (orchestrateur, hors couches) ---
    // Seul : Camoufox peut être un dev Firefox ; CDP peut être DevTools ouverts.
    // Ensemble sur la MÊME session : quasi-certitude d'un bot patchant le navigateur
    // tout en l'automatisant via CDP. Pénalité extra sur L4 pour passer sous 60.
    const isCamoufox = (hwRaw.reasons || []).some(r => r.includes('WebGPU absent'));
    const hasCdpTrap = (autoRaw.score || 0) <= -10;
    if (isCamoufox && hasCdpTrap) {
        const combo = require('../config/tuning').L2.camoufoxCdpCombo;
        hwRaw.score = (hwRaw.score || 0) + combo;
        hwRaw.reasons = [...(hwRaw.reasons || []), 'Camoufox + CDP confirmé — navigateur patché sous automatisation'];
    }

    const hw   = tag(hwRaw,   'L4-Hardware');
    const auto = tag(autoRaw, 'L5-Automation');

    // --- L6 : Biométrie comportementale ---
    const bio = tag(L6_biometrics.analyze({ mouseTrajectory, keystrokes }), 'L6-Biométrie');

    // --- Verdict : agrégation + règle de corroboration (politique, pas heuristique) ---
    const v = verdict.decide([powTagged, l1, acc, hw, auto, bio]);

    // Journalisation structurée par couche — chaque ligne montre sa contribution
    // exacte (score brut + raisons) pour un diagnostic immédiat sans décompiler les logs.
    const logLayer = (label, result) => {
        if (!result) return;
        const sc = result.score ?? 0;
        const txt = (result.reasons || []).map(r => r.replace(/^\[[^\]]+\]\s*/, '')).join(' | ') || '—';
        console.log(`  ├─ [${label.padEnd(14)}] ${(sc >= 0 ? '+' : '') + sc} | ${txt}`);
    };
    console.log(`[ORCHESTRATOR] IP: ${ip} | Score: ${v.score} | Témoins: ${v.witnesses} | Verdict: ${v.allowed ? 'PASS' : v.ban ? 'BAN' : 'BLOCK'}${v.declarative ? ' (déclaratif)' : ''}`);
    logLayer('L1-Réseau',     l1);
    logLayer('L2-Accès',      acc);
    logLayer('L3-PoW',        powTagged);
    logLayer('L4-Hardware',   hw);
    logLayer('L5-Automation', auto);
    logLayer('L6-Biométrie',  bio);

    // --- Mise à jour de la session visiteur et envoi Telegram ---
    // (visitor et sessionId sont déjà résolus en début de pipeline)
    // S'il n'a pas de session (bot pur qui bloque les cookies), on lui crée une fiche temporaire pour Telegram
    if (!visitor) {
        visitor = visitors.createVisitor({ ip, userAgent: req.headers['user-agent'] || 'unknown' });
    }

    visitors.updateVisitor(visitor.id, {
        score: v.score,
        decision: v.allowed ? 'allowed' : (v.ban ? 'blocked' : 'suspect'),
        reasons: v.reasons,
        // Contributions brutes de chaque couche — affichées dans le dashboard admin
        // et utilisées pour le rapport "Copier" par visiteur.
        layerScores: {
            'L1-Réseau':     l1?.score        ?? 0,
            'L2-Accès':      acc?.score       ?? 0,
            'L3-PoW':        powTagged?.score ?? 0,
            'L4-Hardware':   hw?.score        ?? 0,
            'L5-Automation': auto?.score      ?? 0,
            'L6-Biométrie':  bio?.score       ?? 0,
        },
    });
    
    // Notification Telegram uniquement pour les visiteurs suspects ou bloqués.
    if (v.score < 80 || !v.allowed) {
        telegram.notifySuspect(visitor).catch(() => {});
    }

    if (!v.allowed) {
        if (v.ban) {
            reputation.recordStrike(ip);
            console.log(`[MUR DE FER] Bot corroboré (score ${v.score}, ${v.witnesses} couches${v.declarative ? ', déclaratif' : ''}), strike — ACCÈS REFUSÉ. IP: ${ip}`);
        } else {
            // Score insuffisant sans corroboration : marquer suspect et bloquer net.
            reputation.recordSuspect(ip);
            console.log(`[MUR DE FER] Score faible (${v.score}) — ACCÈS REFUSÉ. IP: ${ip}`);
        }
        recordOutcome(ip, v.ban ? 'ban' : 'suspect', v.score, v.witnesses, v.reasons, req.headers['user-agent']);
        
        // ZÉRO CONFIANCE ABSOLUE : Mur de Fer. On coupe la connexion. Aucun token n'est émis.
        // Le bot ne pourra jamais franchir la gateway et restera dans une boucle de rechargement.
        return res.status(403).json({ success: false, message: 'Accès refusé. Humanité non prouvée.' });
    }

    // --- L7 : Session ---
    // Architecture Prisme : le token est émis pour TOUT le monde (allowed ET non-allowed).
    // La suspicion et le sessionSeed sont encodés dans le JWT (AES-256) pour survivre
    // aux redémarrages Render — le store RAM est volatile, le cookie ne l'est pas.
    usedNonces.add(nonce);
    const token = L7_session.createToken(ip, fingerprint, v.score, v.suspicion, visitor.sessionSeed);
    res.cookie('human_auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict', // anti-CSRF : le cookie n'accompagne pas les requêtes cross-site
        maxAge: L7_session.SESSION_DURATION_MS,
    });

    const outcome = v.allowed ? 'pass' : (v.ban ? 'ban' : 'suspect');
    recordOutcome(ip, outcome, v.score, v.witnesses, v.allowed ? [] : v.reasons, req.headers['user-agent']);
    if (v.allowed) console.log(`[VALIDATION_PASSED] Score: ${v.score}. IP: ${ip}`);

    // Le client reçoit toujours success:true + la suspicion pour adapter l'UX
    // (ex: pas de redirect Google côté client — simplement recharger la page).
    res.json({ success: true, suspicion: parseFloat(v.suspicion.toFixed(2)), score: v.score });
};

exports.recordSilentFeedback = (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;

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
