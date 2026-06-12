// Paramètres de calibration du pipeline antibot
// ═══════════════════════════════════════════════
// TOUTES les pénalités et seuils qui pilotent les décisions sont ici.
// Pour ajuster la sensibilité : modifier ce fichier uniquement.
// Les couches contiennent la LOGIQUE de détection, jamais les valeurs numériques.

module.exports = {

    // ── VERDICT ────────────────────────────────────────────────────────────────
    // Seuils qui définissent ALLOWED / BLOCKED / BAN.
    verdict: {
        trustThreshold:   60,   // score ≥ → ALLOWED  (< → BLOCKED, retryable)
        strikeThreshold:  20,   // score < → BAN possible (si corroboration ≥2 témoins)
        significantSignal: -15, // contribution min. d'une couche pour compter comme témoin
    },

    // ── L1 · Réseau & UA ───────────────────────────────────────────────────────
    L1: {
        headerOrder:  -15,  // Host pas en premier — proxy/CDN aussi → signal faible
        uaCasing:     -15,  // casse "user-agent" HTTP/1.x — librairies HTTP, proxys
        knownBotUa:  -100,  // bot s'auto-identifie (Googlebot, sqlmap…) — déclaratif
    },

    // ── L2 · Accès / IP ────────────────────────────────────────────────────────
    L2: {
        // Volontairement faible (-15) : Cloudflare WARP, iCloud Relay et entreprises
        // font sortir des humains par des IP datacenter. Seul, ne bloque jamais.
        datacenter:   -15,
    },

    // ── L4 · Empreinte matérielle ──────────────────────────────────────────────
    L4: {
        headlessRenderer: -35,  // SwiftShader / ANGLE-Software (headless, OU GPU blocklisté)
        vdiRenderer:      -25,  // llvmpipe / Microsoft Basic Render (RDP, VM sans GPU)
        absence: {
            cap:    -20,  // plafond global absences — Brave/Tor/RFP ne bloquent jamais seuls
            webgl:  -15,
            canvas: -10,
            audio:  -10,
        },
        sensorDesync:   -100,  // injection JS d'événements d'entrée (preuve)
        incompleteFp:    -20,  // payload malformé (UA absent)
        webgpuAbsent:    -20,  // Camoufox : Chrome≥113 + WebGL OK + WebGPU absent
    },

    // ── L5 · Automation / CDP ──────────────────────────────────────────────────
    L5: {
        webdriverNative:  -100, // navigator.webdriver === true (Selenium/Playwright brut)
        stealthArtifacts:  -80, // $cdc_, $wdc_ — artefacts ChromeDriver uniquement
        webdriverPatched:  -60, // accesseur webdriver réécrit (furtivité active)
        cdpProxyTrap:      -10, // piège Proxy — FP possible Chrome Mobile → signal faible
        cdpStackTrap:      -10, // piège Error.stack
        firefoxDriver:     -40, // attribut webdriver sur <html> (geckodriver/Marionette)
        vsyncAbsent:       -20, // aucun frame rAF → pas de compositeur graphique réel
        vsyncSynthetic:    -15, // cadence constante → horloge synthétique OU RFP/RDP
    },

    // ── L6 · Biométrie ─────────────────────────────────────────────────────────
    L6: {
        // -50 : bot qui exécute le JS (passe le timeout 15s) mais reste immobile.
        // Combiné à 1 seul autre témoin (CDP, datacenter, renderer), score < 60 → BLOCK.
        // Anti-FP : un humain clavier-seul produit ≥5 frappes → prend missingPointer (-5).
        noInteraction:     -50,
        missingPointer:     -5, // clavier seul — accessibilité légitime, signal très faible
        missingKeyboard:     0, // souris sans clavier — intentionnellement neutre
        teleport:          -70, // saut > 300px en < 50ms (clic par coordonnées VLM)
        straightLine:      -60, // trajectoire parfaitement linéaire
        syntheticInject:   -50, // pointerdown absent ou pression/géométrie nulles (CDP)
        smoothed:          -80, // jerk nul (trajectoire générée)
        flatCadence:       -40, // dwell times identiques (frappe injectée)
        superhumanTyping:  -40, // vol moyen < 8ms (injection en rafale)
    },
};
