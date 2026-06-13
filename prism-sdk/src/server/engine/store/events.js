// Store des événements de verdict — la MÉMOIRE GLOBALE du système.
//
// Les couches L1-L7 jugent chacune UNE requête isolée ; aucune ne voit
// l'ensemble du trafic. Ce journal enregistre chaque décision rendue par
// l'orchestrateur pour permettre à l'étage supérieur (policy/posture.js)
// de raisonner sur la FLOTTE : volume hostile, nombre d'IPs distinctes
// impliquées (attaque distribuée), raisons dominantes.
//
// Borné en mémoire (même doctrine que reputation.js) : taille max + TTL,
// élagage paresseux à chaque écriture — pas de setInterval, pas de fuite.

const events = []; // { t, ip, verdict: 'pass'|'block'|'ban'|'fatal', score, witnesses, reasons }
const MAX_EVENTS = 5000;
const EVENT_TTL_MS = 60 * 60 * 1000; // 1 h d'historique suffit à la posture

const HOSTILE_VERDICTS = new Set(['block', 'ban', 'fatal']);

const prune = (now) => {
    // Les événements sont insérés en ordre chronologique : on coupe par l'avant.
    let firstValid = 0;
    while (firstValid < events.length && now - events[firstValid].t > EVENT_TTL_MS) firstValid++;
    if (firstValid > 0) events.splice(0, firstValid);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
};

// `t` optionnel : les tests injectent des horodatages contrôlés.
// `ua` optionnel : User-Agent de la requête — utilisé pour le calcul d'entropie
// Shannon (détection low-and-slow botnet à pool UA limité).
const record = ({ ip, verdict, score, witnesses, reasons, t, ua }) => {
    const now = Date.now();
    events.push({
        t: t || now,
        ip: ip || 'unknown',
        verdict,
        score: score || 0,
        witnesses: witnesses || 0,
        reasons: Array.isArray(reasons) ? reasons : [],
        ua: ua || null,
    });
    prune(now);
};

// Entropie de Shannon (bits) sur une distribution de fréquences.
// H = -Σ p(x) · log2(p(x)). Retourne 0 si distribution vide.
// Faible entropie = pool UA limité = signal de botnet low-and-slow.
const shannonEntropy = (freqMap) => {
    const total = [...freqMap.values()].reduce((s, v) => s + v, 0);
    if (total === 0) return 0;
    let h = 0;
    for (const c of freqMap.values()) {
        if (c > 0) { const p = c / total; h -= p * Math.log2(p); }
    }
    return h;
};

// Statistiques agrégées sur une fenêtre glissante. `now` optionnel (tests).
const statsWindow = (windowMs, now) => {
    now = now || Date.now();
    const counts = { total: 0, pass: 0, block: 0, ban: 0, fatal: 0 };
    const hostileIps = new Set();
    const reasonCounts = new Map();
    const uaCounts = new Map();

    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (now - e.t > windowMs) break; // ordre chronologique : tout le reste est trop vieux
        if (e.t > now) continue;         // événements "futurs" exclus (fenêtres de test)
        counts.total++;
        if (counts[e.verdict] !== undefined) counts[e.verdict]++;
        if (HOSTILE_VERDICTS.has(e.verdict)) {
            hostileIps.add(e.ip);
            for (const r of e.reasons) reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
        }
        if (e.ua) uaCounts.set(e.ua, (uaCounts.get(e.ua) || 0) + 1);
    }

    const topReasons = [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count }));

    return {
        ...counts,
        hostile: counts.block + counts.ban + counts.fatal,
        hostileIps: hostileIps.size,
        topReasons,
        // Entropie UA : NaN si < UA_ENTROPY_MIN_REQUESTS événements (non utilisable).
        uaEntropy: uaCounts.size > 0 ? shannonEntropy(uaCounts) : NaN,
        uaDistinctCount: uaCounts.size,
    };
};

const size = () => events.length;
const clear = () => { events.length = 0; }; // pour les tests

module.exports = { record, statsWindow, size, clear, MAX_EVENTS, EVENT_TTL_MS };
