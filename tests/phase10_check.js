// Test de régression Phase 10 — BLOCAGE À LA RACINE : Google + scanners + AV.
// Vérifie que TOUS les bots Google officiels, les scanners de vulnérabilités,
// les crawlers AV/réputation et les bots de prévisualisation sociale sont couverts
// par L1 (declarative:true → BAN sans corroboration), et que les IP Googlebot
// sont détectées par L2. Contrôle de non-régression sur un humain Chrome.

const L1 = require('../src/layers/L1_network');
const L2 = require('../src/layers/L2_access');
const verdict = require('../src/policy/verdict');

let failures = 0;
function assert(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} ${label} | obtenu=${JSON.stringify(actual)} | attendu=${JSON.stringify(expected)}`);
}
function assertTrue(label, cond) {
    if (!cond) failures++;
    console.log(`${cond ? '✅' : '❌'} ${label}`);
}

// ═══ A. L1 : TOUS LES UA GOOGLE BLOQUÉS ═══
console.log('=== Phase 10 — A. L1 : couverture UA Google complète ===');

// Paires [description, User-Agent réel envoyé par ce bot]
const GOOGLE_UAS = [
    ['Googlebot classique',      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['Google-Extended (IA)',     'Mozilla/5.0 (compatible; Google-Extended)'],
    ['AdsBot-Google',            'AdsBot-Google (+http://www.google.com/adsbot.html)'],
    ['APIs-Google',              'APIs-Google (+https://developers.google.com/webmasters/APIs-Google.html)'],
    ['Storebot-Google',          'Mozilla/5.0 (Linux; Android 7.0; Moto G (4)) Storebot-Google/1.0'],
    ['Google-InspectionTool',    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)'],
    ['GoogleOther',              'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) GoogleOther'],
    ['Google-Safety',            'Google-Safety'],
    ['Mediapartners-Google',     'Mediapartners-Google'],
    ['FeedFetcher-Google',       'FeedFetcher-Google; (+http://www.google.com/feedfetcher.html)'],
    ['Google-Read-Aloud',        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Google-Read-Aloud'],
    ['GoogleWebLight',           'Mozilla/5.0 (Linux; Android 4.2.1; en-us; Nexus 5 Build/JOP40D) GoogleWebLight'],
    ['Google-CloudVertexBot',    'Mozilla/5.0 (compatible; Google-CloudVertexBot/1.0)'],
    ['Google-Producer',          'Mozilla/5.0 (compatible; Google-Producer)'],
];

// Simule L1.analyze via req minimal
function fakeReq(ua) {
    const headers = { 'user-agent': ua };
    // On simule rawHeaders avec Host en premier (ordre correct) pour isoler le signal UA
    return {
        rawHeaders: ['Host', 'example.com', 'User-Agent', ua],
        headers,
        httpVersion: '1.1',
        ip: '66.249.64.1',
        connection: { remoteAddress: '66.249.64.1' },
        l1Signals: null,
    };
}

for (const [desc, ua] of GOOGLE_UAS) {
    const req = fakeReq(ua);
    const captured = { signals: null };
    L1.analyze(req, {}, () => { captured.signals = req.l1Signals; });
    assertTrue(`A. ${desc} → score -100, declarative:true`,
        captured.signals && captured.signals.score === -100 && captured.signals.declarative === true);
}

// ═══ B. L2 : PLAGES IP GOOGLEBOT DÉTECTÉES ═══
console.log('\n=== Phase 10 — B. L2 : couverture IP Googlebot ===');

const GOOGLEBOT_IPS = [
    ['66.249.64.1',   'Googlebot principal (66.249.64.0/19)'],
    ['66.249.80.1',   'Googlebot étendu (66.249.80.0/20)'],
    ['74.125.0.1',    'Google infrastructure (74.125.0.0/16)'],
    ['209.85.128.1',  'Google transit/WRS (209.85.128.0/17)'],
    ['34.0.0.1',      'GCP déjà listé (34.0.0.0/8)'],
    ['35.180.0.1',    'GCP europe déjà listé (35.180.0.0/14)'],
];

for (const [ip, desc] of GOOGLEBOT_IPS) {
    assertTrue(`B. ${desc} → isDatacenter=true`, L2.isDatacenter(ip));
}

// IP résidentielle : ne doit PAS être considérée datacenter
assertTrue('B. IP résidentielle 192.168.1.1 → isDatacenter=false', !L2.isDatacenter('192.168.1.1'));
assertTrue('B. IP résidentielle 89.2.0.1 → isDatacenter=false', !L2.isDatacenter('89.2.0.1'));

// ═══ C. PIPELINE COMPLET : UA Googlebot → BAN sans corroboration ═══
console.log('\n=== Phase 10 — C. Pipeline L1 → verdict : BAN immédiat (declarative) ===');

// Simuler la fusion L1_network+L1_tls comme le fait l'orchestrateur
const reqC = fakeReq('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
L1.analyze(reqC, {}, () => {});
const l1 = reqC.l1Signals;

// L2 sur IP Googlebot réelle
const l2 = L2.analyze({ ip: '66.249.64.1', fingerprint: null });

// Le témoin L1 est déclaratif → le verdict n'exige pas de corroboration
const witnesses = [
    { score: l1.score, reasons: l1.reasons, declarative: l1.declarative },
    { score: l2.score, reasons: l2.reasons },
];
const v = verdict.decide(witnesses);

assertTrue('C1. Googlebot → non autorisé', v.allowed === false);
assertTrue('C2. Googlebot → BAN (declarative suffit)', v.ban === true);
assertTrue(`C3. Score final ≤ 0 (L1 -100 + L2 -15 = -15 base 100 = ${v.score})`, v.score <= 0);

// ═══ D. SCANNERS DE VULNÉRABILITÉS & CRAWLERS AV ═══
console.log('\n=== Phase 10 — D. Scanners de vulnérabilités & AV → declarative:true ===');

const SCANNER_UAS = [
    // Scanners de vulnérabilités
    ['Nikto',              'Mozilla/5.0 (X11; Linux x86_64) Nikto/2.1.6'],
    ['Nessus',             'Mozilla/4.0 (compatible; Nessus SOAP v0.0.1)'],
    ['Nuclei',             'Nuclei - Open-Source / Security Tool'],
    ['SQLMap',             'sqlmap/1.7 (https://sqlmap.org)'],
    ['ZGrab',              'zgrab/0.x'],
    ['OWASP ZAP',          'Mozilla/5.0 (compatible; OWASP ZAP; zaproxy.org)'],
    ['Acunetix',           'Mozilla/5.0 (Windows; acunetix) acunetix/14.0'],
    ['Dirbuster',          'DirBuster-1.0-RC1'],
    ['WFuzz',              'Wfuzz/2.1'],
    ['Metasploit',         'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:31.0) metasploit'],
    // Crawlers AV & réputation
    ['Norton SafeWeb',     'Mozilla/5.0 (compatible; NetSystemsResearch)'],
    ['Sucuri SiteCheck',   'Mozilla/5.0 (compatible; sucuri; site-check)'],
    ['SiteLock',           'SiteLock/1.0 (+https://www.sitelock.com)'],
    ['VirusTotal',         'Mozilla/5.0 (compatible; virustotalcloud/1.0)'],
    ['Malwarebytes',       'Mozilla/5.0 (compatible; Malwarebytes/1.0)'],
    ['Netcraft',           'Mozilla/5.0 (compatible; NetcraftSurveyAgent)'],
    // Crawlers de prévisualisation sociale
    ['Facebook',           'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['Twitter/X',          'Twitterbot/1.0'],
    ['LinkedIn',           'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)'],
    ['Slack',              'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['WhatsApp',           'WhatsApp/2.23.24 A'],
    ['Telegram',           'TelegramBot (like TwitterBot)'],
    ['Discord',            'Mozilla/5.0 (compatible) Discordbot/2.0 (+https://discordapp.com)'],
];

for (const [desc, ua] of SCANNER_UAS) {
    const req = fakeReq(ua);
    L1.analyze(req, {}, () => {});
    assertTrue(`D. ${desc} → declarative:true, BAN immédiat`,
        req.l1Signals && req.l1Signals.score === -100 && req.l1Signals.declarative === true);
}

// ═══ E. NON-RÉGRESSION : humain propre non affecté ═══
console.log('\n=== Phase 10 — E. Non-régression : humain Chrome → PASS ===');

const reqE = fakeReq('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
L1.analyze(reqE, {}, () => {});
const l1E = reqE.l1Signals;
assertTrue('E1. Chrome humain → score L1 = 0', l1E.score === 0);
assertTrue('E2. Chrome humain → declarative = false', l1E.declarative === false);

const l2E = L2.analyze({ ip: '89.2.0.1', fingerprint: null });
const vE = verdict.decide([
    { score: l1E.score, reasons: l1E.reasons, declarative: l1E.declarative },
    { score: l2E.score, reasons: l2E.reasons },
]);
assertTrue('E3. Humain propre → allowed=true', vE.allowed === true);
assertTrue('E4. Humain propre → ban=false', vE.ban === false);

// Firefox mobile humain : vérifie qu'aucune chaîne du nouveau bloc ne correspond
const reqFF = fakeReq('Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0');
L1.analyze(reqFF, {}, () => {});
assertTrue('E5. Firefox mobile humain → score L1 = 0', reqFF.l1Signals.score === 0);

// Safari iOS humain
const reqSF = fakeReq('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
L1.analyze(reqSF, {}, () => {});
assertTrue('E6. Safari iOS humain → score L1 = 0', reqSF.l1Signals.score === 0);

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
