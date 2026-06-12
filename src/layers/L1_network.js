// Couche 1 — Réseau
// Spécialité : anomalies protocolaires HTTP (ordre des headers, casse, UA bot)
//
// Anti-faux-positifs (rapport bots #2) : les proxys d'entreprise, CDN et
// middleboxes légitimes RÉORDONNENT et NORMALISENT les headers d'HUMAINS.
// Ce middleware ne bloque donc plus en dur (l'ancien 403 + ban escaladé
// bannissait des humains derrière un proxy mal configuré) : il dépose un
// signal de score dans req.l1Signals que l'orchestrateur agrège.

// Pénalités allégées (revue faux-positifs) : ces deux signaux se déclenchent
// AUSSI pour des proxys/CDN légitimes qui normalisent les headers d'humains.
// Cumulés (-30) ils ne franchissent jamais le seuil de blocage seuls.
const PENALTIES = {
    headerOrder: -15,   // Host pas en premier : scripts bruts… mais aussi certains proxys
    uaCasing: -15,      // casse "user-agent" en HTTP/1.x : librairies HTTP, mais proxys aussi
    knownBotUA: -100,   // bot s'auto-identifie — aucun navigateur humain ne contient ces chaînes
};

// Bots qui s'auto-identifient dans leur User-Agent (vérification insensible à la casse).
// Aucun navigateur humain réel (Chrome/Firefox/Safari/Edge) ne contient ces chaînes.
// Source : rapport cartographie bots (taxonomie fonctionnelle 4 niveaux, juin 2026).
const BOT_UA_PATTERNS = [
    // Moteurs de recherche
    'googlebot', 'bingbot', 'yandexbot', 'baiduspider', 'duckduckbot',
    'slurp',     'sogou',   'exabot',    'ia_archiver', 'seznambot', 'yeti',
    // Crawlers IA / LLM
    'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web',
    'anthropic-ai', 'cohere-ai', 'google-extended', 'amazonbot',
    'meta-externalagent', 'perplexitybot', 'youbot', 'ai2bot', 'diffbot', 'bytespider',
    // Google bots spécialisés (2025-2026) — aucun navigateur humain ne contient ces chaînes.
    // Sources : developers.google.com/search/docs/crawling-indexing/overview-google-crawlers
    'adsbot-google',         // audit qualité annonces Google Ads
    'apis-google',           // accès programmatique API Google
    'storebot-google',       // Google Shopping / Merchant Center
    'google-inspectiontool', // test en direct Search Console
    'googleother',           // crawler générique Google non catégorisé
    'google-safety',         // vérification sécurité contenu
    'mediapartners-google',  // AdSense (crawl pour cibler les annonces)
    'feedfetcher-google',    // flux RSS / Google Podcasts
    'google-read-aloud',     // lecture audio des pages (Assistant)
    'googleweblight',        // compression mobile marchés émergents
    'google-cloudvertexbot', // Vertex AI / Gemini web grounding (2025)
    'google-producer',       // Google Discover Feed
    // Outils SEO / audit
    'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'rogerbot',
    // Scanners de vulnérabilités & outils d'attaque — jamais dans un UA navigateur humain.
    // Ces outils envoient parfois leur propre nom dans le User-Agent.
    'nikto',          // scanner de vulnérabilités web
    'nessus',         // Tenable Nessus
    'openvas',        // OpenVAS / Greenbone
    'nuclei',         // ProjectDiscovery Nuclei (templates CVE)
    'sqlmap',         // injection SQL automatisée
    'masscan',        // scan de masse de ports
    'zgrab',          // scanner internet ZGrab
    'acunetix',       // Acunetix WVS
    'netsparker',     // Invicti / Netsparker
    'appscan',        // IBM AppScan
    'qualys was',     // Qualys Web Application Scanner
    'w3af',           // w3af web application attack
    'havij',          // outil injection SQL
    'dirbuster',      // énumération de répertoires
    'gobuster',       // GoBuster
    'feroxbuster',    // FeroxBuster
    'wfuzz',          // fuzzer web
    'zaproxy',        // OWASP ZAP
    'metasploit',     // Metasploit Framework
    // Crawlers AV & réputation web — vérifient les sites pour bases de données de sécurité.
    // Bloquer = le site reste « non classé » dans leur base (acceptable pour une app privée).
    'netsystemsresearch', // Norton SafeWeb / ConnectSafe
    'urlscanio',          // urlscan.io
    'sucuri',             // Sucuri SiteCheck
    'sitelock',           // SiteLock Security Scanner
    'virustotalcloud',    // VirusTotal crawler interne
    'malwarebytes',       // Malwarebytes site scanner
    'netcraft',           // Netcraft Anti-Phishing
    'phishtank',          // PhishTank vérification
    'openphish',          // OpenPhish crawler
    // Crawlers de prévisualisation de liens (réseaux sociaux, messageries).
    // Une app privée ne doit pas générer de prévisualisations sur Slack/Twitter/etc.
    'facebookexternalhit', // aperçu lien Facebook / Meta
    'twitterbot',          // Twitter / X card crawler
    'linkedinbot',         // LinkedIn preview
    'slackbot',            // Slack unfurl
    'whatsapp',            // WhatsApp preview
    'telegrambot',         // Telegram link preview
    'discordbot',          // Discord embed
    // Scanners IoT / sécurité réseau
    'shodan', 'zoomeye', 'censys',
    // Bibliothèques HTTP (jamais un navigateur humain)
    'python-requests', 'python-urllib', 'curl/', 'wget/', 'go-http-client',
    'java/', 'okhttp/', 'aiohttp/', 'scrapy/', 'node-fetch', 'axios/',
    // Marqueurs génériques (voir rapport : "spider/crawler = toujours un agent automatisé")
    '/bot', 'crawler', 'spider', 'scraper', 'headlesschrome',
];

const analyze = (req, res, next) => {
    let score = 0;
    const reasons = [];
    // `declarative` : le client s'est IDENTIFIÉ lui-même comme bot (UA Googlebot,
    // curl…). Ce n'est pas une inférence comportementale mais une déclaration —
    // la politique de verdict l'exempte de l'exigence de corroboration.
    let declarative = false;

    const rawKeys = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        rawKeys.push(req.rawHeaders[i]);
    }

    if (rawKeys.length > 0 && rawKeys[0].toLowerCase() !== 'host') {
        score += PENALTIES.headerOrder;
        reasons.push('Ordre des headers anormal (Host absent en tête)');
    }

    const userAgentHeader = rawKeys.find(k => k.toLowerCase() === 'user-agent');
    if (userAgentHeader && userAgentHeader !== 'User-Agent' && req.httpVersion.startsWith('1.')) {
        score += PENALTIES.uaCasing;
        reasons.push('Casse User-Agent non standard (HTTP/1.x)');
    }

    // Détection UA bot : bots qui s'auto-identifient honnêtement dans leur User-Agent.
    // Un navigateur humain ne contient jamais ces chaînes (Chrome/Firefox/Safari/Edge).
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (ua && BOT_UA_PATTERNS.some(p => ua.includes(p))) {
        score += PENALTIES.knownBotUA;
        declarative = true;
        reasons.push(`User-Agent bot connu détecté (${req.headers['user-agent'].slice(0, 60)})`);
    }

    if (reasons.length > 0) {
        console.log(`[L1_NETWORK] ${reasons.join(' | ')} (score ${score}). IP: ${req.ip || req.socket.remoteAddress}`);
    }

    req.l1Signals = { score, reasons, declarative };
    next();
};

module.exports = { analyze, PENALTIES };
