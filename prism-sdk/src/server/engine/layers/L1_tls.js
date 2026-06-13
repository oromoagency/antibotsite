// Couche 1 (réseau) — Empreinte TLS / JA4
// Spécialité : cohérence entre l'empreinte TLS observée (JA4) et le navigateur
//              déclaré (User-Agent). Cible les Gén. 3 (uTLS, curl_cffi, tls_client)
//              qui forgent la couche transport pour se faire passer pour un navigateur.
//
// INGESTION : le JA4 n'est PAS calculable en HTTP simple — il faut le ClientHello.
// En production, un proxy terminant le TLS (Cloudflare, HAProxy, Caddy, nginx+module)
// l'injecte dans l'en-tête `x-ja4`. Cette couche le CONSOMME : neutre si absent
// (aucun proxy configuré), active dès qu'une source JA4 est présente.
//
// Limite assumée : un imitateur parfait (curl_cffi répliquant le JA4 exact de Chrome)
// passe cette couche — c'est précisément pourquoi L4 (GPU) et L5 (CDP) existent.

// Pondération anti-faux-positifs (revue) : les proxys SSL d'entreprise (Zscaler,
// Bluecoat…) re-originent le TLS d'HUMAINS avec une pile non-navigateur, et un
// VRAI bot moderne (uTLS) forge au contraire un TLS 1.3 parfait. Donc TLS 1.2 et
// les listes de ciphers larges sont PLUTÔT des signaux d'humain-derrière-proxy.
// Seul signal vraiment bot-distinctif : l'absence de SNI. Le pire cas proxy
// d'entreprise (-10 cumulé) ne pèse quasi rien ; un Python usurpé (SNI absent +
// peu de ciphers) reste lourdement pénalisé.
const PENALTIES = {
    notTls13: -5,     // TLS 1.2 = middlebox légitime plus souvent que bot (les bots forgent 1.3)
    noSni: -40,       // SNI absent : aucun navigateur ni proxy sérieux ne l'omet — vrai signal bot
    noH2: -5,         // certains proxys d'entreprise négocient http/1.1
    cipherCount: -10, // hors plage élargie ci-dessous
};

// Plage de ciphers tolérée : basse (10) écarte curl/python (~9) ; haute (30)
// laisse passer les piles OpenSSL d'entreprise (~25). Les navigateurs ~15.
const BROWSER_CIPHER_MIN = 10;
const BROWSER_CIPHER_MAX = 30;

// Blocklist exacte (vide par défaut) : à alimenter avec des flux JA4 de bots connus.
const KNOWN_BOT_JA4 = new Set();

const isBrowserUA = (ua) =>
    typeof ua === 'string' &&
    /Mozilla\//.test(ua) &&
    /(Chrome|Firefox|Safari|Edg|OPR)/.test(ua);

// Décompose le bloc JA4_a (lisible) : ex "t13d1516h2" → transport/version/sni/ciphers/ext/alpn
const parseJA4a = (ja4a) => {
    if (!ja4a || ja4a.length < 10) return null;
    return {
        transport: ja4a[0],            // t = TCP, q = QUIC
        version: ja4a.slice(1, 3),     // "13" = TLS 1.3
        sni: ja4a[3],                  // d = présent, i = absent
        cipherCount: parseInt(ja4a.slice(4, 6), 10),
        extCount: parseInt(ja4a.slice(6, 8), 10),
        alpn: ja4a.slice(8, 10),       // "h2"
    };
};

// Retourne { score, reasons }
const analyze = ({ ja4, userAgent }) => {
    if (!ja4) return { score: 0, reasons: [] }; // pas de source JA4 → neutre

    if (KNOWN_BOT_JA4.has(ja4)) {
        return { score: -100, reasons: [`JA4 figurant sur la blocklist bots (${ja4})`] };
    }

    // On ne juge la cohérence que si le client PRÉTEND être un navigateur.
    if (!isBrowserUA(userAgent)) return { score: 0, reasons: [] };

    const a = parseJA4a(ja4.split('_')[0]);
    if (!a) return { score: 0, reasons: [] };

    let score = 0;
    const reasons = [];

    if (a.version !== '13') {
        score += PENALTIES.notTls13;
        reasons.push(`TLS ${a.version} déclaré par un navigateur moderne (attendu 1.3)`);
    }
    if (a.sni !== 'd') {
        score += PENALTIES.noSni;
        reasons.push('SNI absent du ClientHello (anormal pour un navigateur)');
    }
    if (a.alpn !== 'h2') {
        score += PENALTIES.noH2;
        reasons.push(`ALPN "${a.alpn}" (navigateur attendu : h2)`);
    }
    if (Number.isNaN(a.cipherCount) || a.cipherCount < BROWSER_CIPHER_MIN || a.cipherCount > BROWSER_CIPHER_MAX) {
        score += PENALTIES.cipherCount;
        reasons.push(`Nombre de ciphers atypique (${a.cipherCount}) — pile TLS non-navigateur`);
    }

    if (reasons.length > 0) {
        reasons.unshift(`Incohérence TLS/User-Agent (JA4 ${ja4.split('_')[0]} vs UA navigateur)`);
    }
    return { score, reasons };
};

module.exports = { analyze, parseJA4a, isBrowserUA, KNOWN_BOT_JA4, PENALTIES };
