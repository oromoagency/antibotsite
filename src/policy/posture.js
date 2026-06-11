// Posture globale — l'étage de décision AU-DESSUS des couches.
//
// Les couches L1-L7 jugent une requête isolée ; la posture juge la FLOTTE :
// combien de verdicts hostiles dans la fenêtre, depuis combien d'IPs
// distinctes (= attaque distribuée). Trois niveaux : CALME, VIGILANCE, ATTAQUE.
//
// INVARIANT ANTI-FAUX-POSITIFS (doctrine, non négociable) :
//   La posture ne touche JAMAIS aux seuils de verdict (TRUST/STRIKE) ni aux
//   pénalités des couches — durcir les seuils sous attaque ferait payer les
//   HUMAINS pour les bots. Son seul levier est la DIFFICULTÉ du Proof of Work :
//   chaque +1 multiplie par 16 le coût CPU d'une tentative. Un humain attend
//   quelques secondes de plus ; une ferme de bots voit sa cadence s'effondrer.
//
// Plafond de difficulté : 5. À 6, un mobile lent dépasserait la fenêtre
// temporelle de 60 s du PoW (-30) et ce malus s'empilerait avec un signal
// ambigu (RDP -25) jusqu'à bloquer un humain — refusé. ATTAQUE = difficulté 5
// + alerte opérateur sur le tableau de bord.
//
// FENÊTRE DE GRÂCE (anti-FP critique) : quand la difficulté monte, un humain
// qui a commencé à miner SOUS l'ancienne difficulté doit pouvoir soumettre.
// L3 valide donc contre la difficulté MINIMALE ayant été active dans les
// dernières GRACE_MS — jamais contre la difficulté instantanée.

const config = require('../config');
const events = require('../store/events');

const LEVELS = { CALM: 'CALME', VIGILANCE: 'VIGILANCE', ATTACK: 'ATTAQUE' };

const POSTURE_WINDOW_MS = 5 * 60 * 1000; // fenêtre d'observation de la flotte
const GRACE_MS = 90 * 1000;              // fenêtre PoW 60 s + marge de minage

const BASE_DIFFICULTY = config.CHALLENGE_DIFFICULTY; // 4
const MAX_DIFFICULTY = 5;                            // plafond anti-FP (cf. en-tête)
const DIFFICULTY_BY_LEVEL = {
    [LEVELS.CALM]: BASE_DIFFICULTY,
    [LEVELS.VIGILANCE]: MAX_DIFFICULTY,
    [LEVELS.ATTACK]: MAX_DIFFICULTY,
};

// Seuils d'escalade (sur POSTURE_WINDOW_MS) — ABSOLUS, pas des ratios : un
// ratio s'affole sur 3 requêtes dont 2 hostiles alors que le site est calme.
// uaEntropy : entropie Shannon du pool User-Agent (bits). Faible entropie = pool
// limité = botnet low-and-slow (technique 2025-2026 : < 5 req/min/IP distribuée
// sur 50+ IPs mais seulement 2-3 UAs distincts). Actif uniquement si assez de
// données (≥ UA_ENTROPY_MIN_TOTAL requêtes dans la fenêtre) pour éviter les
// faux-positifs sur un site peu fréquenté (peu d'UAs ≠ botnet si peu de trafic).
const THRESHOLDS = {
    VIGILANCE: { hostile: 12, hostileIps: 4, uaEntropy: 1.5 },
    ATTACK:    { hostile: 40, hostileIps: 10, uaEntropy: 0.5 },
};
const UA_ENTROPY_MIN_TOTAL = 100; // minimum de requêtes pour utiliser l'entropie

// Historique des changements de difficulté : [{ difficulty, since }] —
// nécessaire pour la fenêtre de grâce. Borné : on n'y garde que ce qui peut
// encore servir (entrées dont le règne touche les dernières GRACE_MS).
let history = [{ difficulty: BASE_DIFFICULTY, since: 0 }];
let level = LEVELS.CALM;

const pruneHistory = (now) => {
    // On garde la dernière entrée dont le règne COUVRE le début de la fenêtre
    // de grâce, et tout ce qui suit.
    let keepFrom = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].since <= now - GRACE_MS) { keepFrom = i; break; }
    }
    if (keepFrom > 0) history = history.slice(keepFrom);
};

// Recalcule le niveau depuis le journal des verdicts. Appelé à chaque
// requête de configuration de challenge et à chaque verdict — paresseux,
// pas de timer. `now` optionnel (tests).
const evaluate = (now) => {
    now = now || Date.now();
    const s = events.statsWindow(POSTURE_WINDOW_MS, now);

    // L'entropie n'est utilisable qu'au-dessus du seuil minimum de trafic
    // (NaN si aucun UA enregistré, ignoré par les comparaisons numériques).
    const entropyActive = s.total >= UA_ENTROPY_MIN_TOTAL && !isNaN(s.uaEntropy);
    const entropyAttack    = entropyActive && s.uaEntropy <= THRESHOLDS.ATTACK.uaEntropy;
    const entropyVigilance = entropyActive && s.uaEntropy <= THRESHOLDS.VIGILANCE.uaEntropy;

    let next = LEVELS.CALM;
    if (s.hostile >= THRESHOLDS.ATTACK.hostile || s.hostileIps >= THRESHOLDS.ATTACK.hostileIps || entropyAttack) {
        next = LEVELS.ATTACK;
    } else if (s.hostile >= THRESHOLDS.VIGILANCE.hostile || s.hostileIps >= THRESHOLDS.VIGILANCE.hostileIps || entropyVigilance) {
        next = LEVELS.VIGILANCE;
    }

    if (next !== level) {
        const entropyInfo = entropyActive ? `, entropie UA=${s.uaEntropy.toFixed(2)} bits` : '';
        console.log(`[POSTURE] ${level} → ${next} (hostiles=${s.hostile}, IPs hostiles=${s.hostileIps}${entropyInfo} sur ${Math.round(POSTURE_WINDOW_MS / 60000)} min)`);
        level = next;
    }

    const targetDifficulty = DIFFICULTY_BY_LEVEL[level];
    if (history[history.length - 1].difficulty !== targetDifficulty) {
        history.push({ difficulty: targetDifficulty, since: now });
    }
    pruneHistory(now);
    return level;
};

const currentLevel = () => level;
const currentDifficulty = () => history[history.length - 1].difficulty;

// Difficulté minimale acceptable à la vérification : le MIN de toutes les
// difficultés ayant été actives dans les dernières GRACE_MS. Un hash miné à
// une difficulté SUPÉRIEURE satisfait toujours une exigence inférieure
// (préfixe de zéros plus long) — seule la borne basse compte.
const minAcceptableDifficulty = (now) => {
    now = now || Date.now();
    let min = Infinity;
    for (let i = 0; i < history.length; i++) {
        const reignEnd = i + 1 < history.length ? history[i + 1].since : Infinity;
        if (reignEnd >= now - GRACE_MS && history[i].since <= now) {
            min = Math.min(min, history[i].difficulty);
        }
    }
    return min === Infinity ? BASE_DIFFICULTY : min;
};

// Réinitialisation complète — pour les tests uniquement.
const _reset = () => {
    history = [{ difficulty: BASE_DIFFICULTY, since: 0 }];
    level = LEVELS.CALM;
};

module.exports = {
    evaluate, currentLevel, currentDifficulty, minAcceptableDifficulty,
    LEVELS, THRESHOLDS, POSTURE_WINDOW_MS, GRACE_MS, BASE_DIFFICULTY, MAX_DIFFICULTY,
    _reset,
};
