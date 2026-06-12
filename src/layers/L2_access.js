// Couche 2 — Accès & réputation IP
// Spécialité : QUI accède, D'OÙ et À QUELLE CADENCE — barrière des IP bannies
//              (temporaire), détection d'infrastructure datacenter, vélocité
//              des tentatives. Ne fait AUCune analyse protocolaire (→ L1) ni de contenu.

const crypto = require('crypto-js');
const reputation = require('../store/reputation');

// ============================================================
// WHITELIST — IPs/ASNs de confiance, jamais bloqués
// ============================================================
const WHITELIST_IPS  = new Set();  // IPs exactes en whitelist
const WHITELIST_ASNS = new Set();  // ASNs en whitelist — vide par défaut, base neutre

const addToWhitelist = (value) => {
    if (!value) return;
    const v = String(value).trim().toUpperCase();
    if (v.startsWith('AS')) { WHITELIST_ASNS.add(v); return 'asn'; }
    WHITELIST_IPS.add(v);
    return 'ip';
};

const removeFromWhitelist = (value) => {
    const v = String(value).trim().toUpperCase();
    if (v.startsWith('AS')) { WHITELIST_ASNS.delete(v); return; }
    WHITELIST_IPS.delete(v);
};

const isWhitelisted = (ip, asn) => {
    if (ip && WHITELIST_IPS.has(String(ip).trim())) return true;
    if (asn) {
        // L'ASN peut être au format 'AS36974 MTN...' — on extrait juste 'AS36974'
        const asnCode = String(asn).trim().split(' ')[0].toUpperCase();
        if (WHITELIST_ASNS.has(asnCode)) return true;
    }
    return false;
};

const getWhitelist = () => ({
    ips: [...WHITELIST_IPS],
    asns: [...WHITELIST_ASNS],
});


const { L2: _T } = require('../config/tuning');
const DATACENTER_PENALTY = _T.datacenter;
const SUSPECT_IP_PENALTY = _T.suspectIp;
const ASN_PENALTY        = _T.asnBlacklist;
const ASN_BLACKLIST      = new Set(_T.blacklistedAsns);

// Plages CIDR datacenter représentatives. Sous-ensemble volontairement court :
// en production, charger les listes publiées (AWS ip-ranges.json, GCP, Azure...).
// Un utilisateur résidentiel/mobile légitime ne provient pas de ces plages.
const DATACENTER_CIDRS = [
    ['3.0.0.0', 8],       // AWS
    ['13.32.0.0', 12],    // AWS / CloudFront
    ['18.32.0.0', 11],    // AWS
    ['52.0.0.0', 8],      // AWS
    ['34.0.0.0', 8],      // GCP
    ['35.180.0.0', 14],   // GCP (europe)
    // Plages dédiées Googlebot — reverse DNS *.googlebot.com / *.google.com vérifié.
    // Source : developers.google.com/search/apis/ipranges/googlebot.json
    ['66.249.64.0', 19],  // Googlebot principal
    ['66.249.80.0', 20],  // Googlebot (bloc étendu)
    ['74.125.0.0', 16],   // Google infrastructure (WRS, fetch)
    ['209.85.128.0', 17], // Google transit / Web Rendering Service
    ['20.0.0.0', 8],      // Azure
    ['40.64.0.0', 10],    // Azure
    ['104.16.0.0', 12],   // Cloudflare (104.16-31.x.x)
    ['172.64.0.0', 13],   // Cloudflare (172.64-71.x.x — bots proxiant via CF Workers/Tunnel)
    ['162.158.0.0', 15],  // Cloudflare (162.158-159.x.x)
    ['157.230.0.0', 16],  // DigitalOcean
    ['159.65.0.0', 16],   // DigitalOcean
    ['51.15.0.0', 16],    // Scaleway / OVH
    ['95.216.0.0', 15],   // Hetzner
];

// Conversion IPv4 -> entier par arithmétique (évite les pièges du bitwise 32 bits signé).
const ipToInt = (ip) => {
    const clean = String(ip).replace(/^::ffff:/, '');
    const parts = clean.split('.');
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        const octet = parseInt(p, 10);
        if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
        n = n * 256 + octet;
    }
    return n;
};

const inCidr = (ipInt, baseIp, bits) => {
    const baseInt = ipToInt(baseIp);
    if (ipInt === null || baseInt === null) return false;
    if (bits === 0) return true;
    const blockSize = Math.pow(2, 32 - bits);
    return Math.floor(ipInt / blockSize) === Math.floor(baseInt / blockSize);
};

const isDatacenter = (ip) => {
    const ipInt = ipToInt(ip);
    if (ipInt === null) return false; // IPv6 / inconnu : non jugé ici
    return DATACENTER_CIDRS.some(([base, bits]) => inCidr(ipInt, base, bits));
};

// Middleware : barrière dure pour les IP temporairement bannies.
const middleware = (req, res, next) => {
    const ip = req.ip || '';
    // Whitelist : jamais bloqué, jamais redirigé
    if (isWhitelisted(ip)) return next();
    if (reputation.isBanned(ip)) {
        console.log(`[L2_ACCESS] IP bannie temporairement: ${ip}`);
        if (req.method === 'GET' && !req.path.startsWith('/api')) {
            return res.redirect('https://www.google.com');
        }
        return res.status(403).send('Forbidden.');
    }
    next();
};

// Vélocité (rapport bots #3 : « volumes d'actions anormalement élevés ») :
// cadence de tentatives de validation sur 60 s glissantes. DEUX compteurs :
//
//   1. FIN, par clé IP+empreinte : cible un device précis qui martèle. Tolérant
//      pour ne pas punir l'humain qui réessaie après un refus (≤ 4/min = rien).
//      ATTENTION : ce n'est PAS « CGNAT-safe » au sens absolu — deux humains au
//      même NAT avec la MÊME empreinte (Chrome 1080p même langue) partagent la clé
//      et peuvent CUMULER. Mais ça ne les BANNIT jamais : un humain interagit
//      (L6 = 0), donc la vélocité reste l'unique témoin → la corroboration
//      (verdict.js) impose au pire un refus retryable, jamais un ban.
//
//   2. GROSSIER, par IP seule : ferme le contournement « j'omets/varie l'empreinte
//      pour réinitialiser le compteur fin » (revue, faux-négatif critique). Seuils
//      BEAUCOUP plus hauts (un gros NAT d'entreprise peut légitimement émettre des
//      dizaines de validations/min) ; sert de 2e témoin face à un script sans
//      télémétrie (L6 = 1er témoin), jamais de motif de ban à lui seul.
const VELOCITY_TIERS_FP = [
    { count: 15, penalty: -75, label: 'martèlement (device)' },
    { count: 9,  penalty: -40, label: 'cadence très élevée (device)' },
    { count: 5,  penalty: -15, label: 'cadence élevée (device)' },
];
const VELOCITY_TIERS_IP = [
    { count: 60, penalty: -60, label: 'martèlement (IP)' },
    { count: 30, penalty: -30, label: 'cadence très élevée (IP)' },
];

// Signal de score pour l'orchestrateur : provenance datacenter, ASN, réputation,
// vélocité. `fingerprint` et `asn` sont optionnels.
const analyze = ({ ip, fingerprint, asn }) => {
    let score = 0;
    const reasons = [];

    if (isDatacenter(ip)) {
        score += DATACENTER_PENALTY;
        reasons.push(`Trafic datacenter détecté (${ip})`);
    }

    // ASN hébergeur/infrastructure : jamais d'utilisateur résidentiel sur ces plages.
    if (asn) {
        const asnCode = String(asn).trim().split(' ')[0].toUpperCase();
        if (ASN_BLACKLIST.has(asnCode)) {
            score += ASN_PENALTY;
            reasons.push(`ASN hébergeur/infrastructure (${asnCode}) — non résidentiel`);
        }
    }

    // IP marquée suspecte (bloquée dans les 30 dernières minutes sans ban).
    if (reputation.isSuspect(ip)) {
        score += SUSPECT_IP_PENALTY;
        reasons.push('IP suspecte — blocage récent (< 30 min)');
    }

    // Compteur grossier par IP (toujours actif).
    const nIp = reputation.recordAttempt(`ip|${ip}`);
    let velPenalty = 0;
    let velReason = null;
    const tierIp = VELOCITY_TIERS_IP.find(t => nIp >= t.count);
    if (tierIp) { velPenalty = tierIp.penalty; velReason = `Cadence de tentatives anormale (${nIp}/min — ${tierIp.label})`; }

    // Compteur fin par IP+empreinte (si empreinte fournie) — on garde le pire.
    if (fingerprint) {
        const fpHash = crypto.SHA256(JSON.stringify(fingerprint)).toString().slice(0, 16);
        const nFp = reputation.recordAttempt(`${ip}|${fpHash}`);
        const tierFp = VELOCITY_TIERS_FP.find(t => nFp >= t.count);
        if (tierFp && tierFp.penalty < velPenalty) {
            velPenalty = tierFp.penalty;
            velReason = `Cadence de tentatives anormale (${nFp}/min — ${tierFp.label})`;
        }
    }

    if (velPenalty < 0) {
        score += velPenalty;
        reasons.push(velReason);
    }

    return { score, reasons };
};

module.exports = { middleware, analyze, isDatacenter, isWhitelisted, addToWhitelist, removeFromWhitelist, getWhitelist, DATACENTER_CIDRS, DATACENTER_PENALTY, VELOCITY_TIERS_FP, VELOCITY_TIERS_IP };
