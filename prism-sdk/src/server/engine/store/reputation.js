// Store de réputation IP — bannissements TEMPORAIRES à TTL escaladé.
//
// Le rapport est explicite : une IP CGNAT/mobile peut masquer des milliers
// d'humains légitimes. Bannir une IP à vie (1) exclut de vrais utilisateurs et
// (2) n'arrête pas les bots, qui font tourner leurs proxys résidentiels.
// → On bannit donc temporairement, avec une durée qui s'allonge à chaque récidive.

const bans     = new Map(); // ip -> timestamp d'expiration (ms)
const strikes  = new Map(); // ip -> { count, ts }
const suspects = new Map(); // ip -> timestamp d'expiration (ms) — BLOQUÉ mais pas banni

// TTL par récidive : 5 min, puis 30 min, puis 2 h (plafond).
const STRIKE_TTL = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000];
// Au-delà de cette inactivité, l'historique de strikes d'une IP est oublié (revue) :
// (1) évite la croissance mémoire non bornée de la Map `strikes` sur un botnet à IP
// tournantes ; (2) une IP réattribuée (DHCP/CGNAT) ne traîne pas le passé d'un autre.
const STRIKE_MEMORY_MS = 24 * 60 * 60 * 1000;

const isLoopback = (ip) =>
    !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

const isBanned = (ip) => {
    const exp = bans.get(ip);
    if (!exp) return false;
    if (Date.now() > exp) { bans.delete(ip); return false; } // expiration paresseuse
    return true;
};

// Balaye les entrées `strikes` plus vieilles que STRIKE_MEMORY_MS. Appelé à chaque
// strike : O(n) amorti négligeable, borne la mémoire sans setInterval.
const pruneStrikes = (now) => {
    for (const [ip, rec] of strikes) {
        if (now - rec.ts > STRIKE_MEMORY_MS) strikes.delete(ip);
    }
};

// Enregistre une infraction et applique un ban temporaire escaladé.
const recordStrike = (ip) => {
    if (isLoopback(ip)) return { strikes: 0, ttl: 0 }; // pas d'auto-lockout en dev
    const now = Date.now();
    pruneStrikes(now);
    const prev = strikes.get(ip);
    const n = (prev && now - prev.ts <= STRIKE_MEMORY_MS ? prev.count : 0) + 1;
    strikes.set(ip, { count: n, ts: now });
    const ttl = STRIKE_TTL[Math.min(n - 1, STRIKE_TTL.length - 1)];
    bans.set(ip, now + ttl);
    console.log(`[REPUTATION] Strike #${n} pour ${ip} — ban ${Math.round(ttl / 60000)} min`);
    return { strikes: n, ttl };
};

// Marque une IP comme suspecte après un BLOCAGE simple (sans ban).
// TTL court : 30 min. Une IP bloquée qui réessaie immédiatement reçoit
// -30 supplémentaires en L2, ce qui force généralement le seuil de ban.
const SUSPECT_TTL = 30 * 60 * 1000;
const recordSuspect = (ip) => {
    if (isLoopback(ip)) return;
    suspects.set(ip, Date.now() + SUSPECT_TTL);
    console.log(`[REPUTATION] IP suspecte (blocage récent) : ${ip} — pénalité L2 pendant 30 min`);
};

const isSuspect = (ip) => {
    const exp = suspects.get(ip);
    if (!exp) return false;
    if (Date.now() > exp) { suspects.delete(ip); return false; }
    return true;
};

const getReputation = (ip) => ({
    banned: isBanned(ip),
    suspect: isSuspect(ip),
    strikes: (strikes.get(ip) || {}).count || 0,
});

// --- Cadence de tentatives (vélocité) ---
// Compte les tentatives de validation par clé sur une fenêtre glissante.
// La clé est composée par l'appelant (L2 : IP + hash d'empreinte, pour que
// deux collègues derrière le même NAT d'entreprise ne se polluent pas).
const attempts = new Map(); // clé -> tableau de timestamps (ms)
const ATTEMPT_WINDOW_MS = 60 * 1000;

const recordAttempt = (key) => {
    const now = Date.now();
    const list = (attempts.get(key) || []).filter(t => now - t < ATTEMPT_WINDOW_MS);
    list.push(now);
    attempts.set(key, list);
    return list.length; // nombre de tentatives dans la fenêtre, celle-ci incluse
};

module.exports = { isBanned, recordStrike, isSuspect, recordSuspect, getReputation, recordAttempt, STRIKE_TTL, SUSPECT_TTL, ATTEMPT_WINDOW_MS };
