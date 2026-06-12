// Couche 5 — Détection d'automatisation
// Spécialité : déceler la PRÉSENCE d'un framework de pilotage (WebDriver, CDP),
//              indépendamment de l'empreinte matérielle (→ L4) ou du comportement (→ L6).
//
// Cible directement les Générations 2-4 du rapport : Puppeteer, Playwright,
// Selenium, Browser Use — qui pilotent tous le navigateur via le
// Chrome DevTools Protocol (CDP) ou l'interface WebDriver.

// Poids ajustables — équilibre faux-positifs / faux-négatifs (revue adversariale) :
//   - PREUVES définitives (webdriver natif, artefacts $cdc_) : poids forts.
//   - Pièges CDP RENFORCÉS (-45/-15 = -60) : avec l'ancien -35, nodriver (G3) —
//     qui déclenche les DEUX pièges mais a un vrai GPU et une biométrie maquillée —
//     PASSAIT à 65. -45 sur le piège Proxy ferme AUSSI le cas-limite « un seul piège »
//     (revue) : avec -40, un nodriver ne déclenchant que le piège Proxy tombait pile
//     à 60 et PASSAIT (seuil >=). À -45 il est à 55 (bloqué). Contrepartie ASSUMÉE :
//     un développeur DevTools ouverts est aussi bloqué — population ~nulle en prod,
//     JAMAIS bannie (1 témoin, et loopback non bannissable). On peut réessayer.
//   - vsyncSynthetic ABAISSÉ (-15) : Firefox resistFingerprinting ET le rendu RDP/VDI
//     quantifient les timers → variance ~nulle chez un HUMAIN. Signal faible des deux côtés.
const WEIGHTS = {
    webdriverNative: -100,   // navigator.webdriver === true (Selenium/Playwright non furtif)
    stealthArtifacts: -80,   // $cdc_, $wdc_ : n'existent QUE sous ChromeDriver
    webdriverPatched: -60,   // accesseur webdriver réécrit (furtivité active)
    cdpProxyTrap: -10,        // piège Proxy (faux-positifs possibles sur Chrome Mobile)
    cdpStackTrap: -10,        // piège Error.stack
    // Firefox geckodriver / Marionette (rapport 2026 : Camoufox contourne les pièges
    // Chromium/CDP mais ne peut pas retirer l'attribut webdriver posé par geckodriver
    // sur l'élément <html> — distinct de navigator.webdriver qui lui est patchable).
    firefoxDriver: -40,
    vsyncAbsent: -20,         // aucune frame rAF : pas de compositeur réel (headless)
    vsyncSynthetic: -15,      // cadence parfaitement constante (horloge synthétique OU RFP/RDP humain)
};

// CORRECTION (revue) : l'ancien `vsync.length < 10 → return 0` SAUTAIT le test
// avant même d'appliquer la pénalité d'absence — un bot (nodriver) qui n'envoyait
// aucune frame récoltait 0. Un navigateur réel au premier plan produit pourtant
// des dizaines de frames rAF pendant les secondes de collecte. On filtre d'abord,
// puis on pénalise l'absence (< 5 frames valides), survivable pour un humain.
const analyzeVSync = (vsync) => {
    const frames = Array.isArray(vsync) ? vsync.filter(d => d > 0) : [];

    if (frames.length < 5) {
        return { score: WEIGHTS.vsyncAbsent, reason: 'Cadence VSync absente/insuffisante (pas de compositeur graphique réel)' };
    }

    const mean = frames.reduce((s, d) => s + d, 0) / frames.length;
    let variance = 0;
    for (const d of frames) variance += (d - mean) ** 2;
    variance /= frames.length;

    // Seuil 0.001 (revue) : un peu plus tolérant que 0.0001 sans rien céder — une
    // horloge réellement synthétique (Array.fill, bot) a une variance ~1e-30, très
    // loin sous 0.001 ; un vrai moniteur jitte de 0.1-1ms (variance >> 0.001).
    if (variance < 0.001) {
        return { score: WEIGHTS.vsyncSynthetic, reason: 'Cadence VSync parfaitement constante (horloge synthétique)' };
    }
    return { score: 0, reason: null };
};

// Retourne { score, reasons }
const analyze = ({ automation, vsync }) => {
    let score = 0;
    const reasons = [];
    const a = automation || {};

    if (a.webdriver === true) {
        score += WEIGHTS.webdriverNative;
        reasons.push('navigator.webdriver = true');
    }

    if (a.stealthArtifacts === true) {
        score += WEIGHTS.stealthArtifacts;
        reasons.push('Artefacts ChromeDriver/WebDriver présents ($cdc_/$wdc_)');
    }

    if (a.webdriverPatched === true) {
        score += WEIGHTS.webdriverPatched;
        reasons.push('Accesseur navigator.webdriver patché (furtivité)');
    }

    if (a.cdpProxyTrap === true) {
        score += WEIGHTS.cdpProxyTrap;
        reasons.push('Piège CDP (Proxy) déclenché — DevTools Protocol actif');
    }

    if (a.cdpStackTrap === true) {
        score += WEIGHTS.cdpStackTrap;
        reasons.push('Piège CDP (Error.stack) déclenché');
    }

    if (a.firefoxDriver === true) {
        score += WEIGHTS.firefoxDriver;
        reasons.push('Attribut webdriver sur <html> (geckodriver/Marionette Firefox)');
    }

    const vs = analyzeVSync(vsync);
    score += vs.score;
    if (vs.reason) reasons.push(vs.reason);

    return { score, reasons };
};

module.exports = { analyze, WEIGHTS };
