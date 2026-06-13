// Couche 4 — Empreinte matérielle
// Spécialité : cohérence de l'environnement physique (Canvas / WebGL / AudioContext),
//              désynchronisation des capteurs.
// Ne juge PAS la présence d'un framework d'automatisation (→ voir L5_automation).
//
// Philosophie anti-faux-positifs (rapport bots #2) :
//   - L'ABSENCE d'un signal est AMBIGUË : Brave (farbling), Firefox
//     resistFingerprinting, CanvasBlocker et les bloqueurs privent un HUMAIN
//     légitime de Canvas/WebGL/Audio → pénalités légères, PLAFONNÉES ensemble
//     (ABSENCE_CAP) pour qu'un navigateur vie-privée ne soit jamais bloqué seul.
//   - La PREUVE d'environnement synthétique (renderer GPU logiciel, événements
//     d'entrée à dt < 1ms) est quasi impossible pour un humain → pénalité forte,
//     cumulable sans plafond.
//
// WEI (navigator.getEnvironmentIntegrity) a été RETIRÉ : l'API n'existe dans
// AUCUN navigateur (proposition Google abandonnée en 2023). L'ancien code
// pénalisait 100 % des humains réels et créditait +5 tout bot envoyant un
// jeton arbitraire — logique inversée.

// Renderers GPU "logiciels" — reclassés AMBIGUS (rapport bots #3 : un seul
// indicateur ne conclut jamais). Deux familles, deux poids :
//   - HEADLESS_RENDERERS : SwiftShader/ANGLE-Software, la signature classique du
//     headless… mais Chrome retombe AUSSI sur SwiftShader pour un HUMAIN dont le
//     GPU est blocklisté (drivers cassés/anciens). Signal fort, plus une preuve.
//   - VDI_RENDERERS : "Microsoft Basic Render Driver" = employé en Remote
//     Desktop ; llvmpipe = VM Linux sans passthrough GPU. Humains légitimes
//     en environnement professionnel → signal modéré.
// L'ancien -100 mono-signal bannissait un employé RDP. Désormais : seul, aucun
// des deux ne bloque (100-35=65, 100-25=75) ; cumulé avec un 2e témoin (CDP,
// webdriver, biométrie), le bot tombe et la corroboration autorise le ban.
const HEADLESS_RENDERERS = ['swiftshader', 'google swiftshader', 'angle (software'];
const VDI_RENDERERS = ['llvmpipe', 'softpipe', 'mesa offscreen', 'microsoft basic render'];
const SOFTWARE_RENDERERS = [...HEADLESS_RENDERERS, ...VDI_RENDERERS];

const { L4: _T } = require('../config/tuning');
const HEADLESS_RENDERER_PENALTY  = _T.headlessRenderer;
const VDI_RENDERER_PENALTY       = _T.vdiRenderer;
const ABSENCE_PENALTIES          = _T.absence;
const ABSENCE_CAP                = _T.absence.cap;
const SENSOR_DESYNC_PENALTY      = _T.sensorDesync;
const INCOMPLETE_FP_PENALTY      = _T.incompleteFp;
const WEBGPU_ABSENT_PENALTY      = _T.webgpuAbsent;
const BATTERY_SPOOF_PENALTY      = _T.batterySpoof;
const SCREEN_POINTER_NONE        = _T.screenPointerNone;
const SCREEN_MOBILE_MISMATCH     = _T.screenMobileMismatch;

// Vérifie les signaux liés à la présence d'un écran physique réel.
// Ne pénalise PAS les navigateurs sans données (screenProfile absent = client ancien).
const analyzeScreen = (screenProfile, fingerprint) => {
    if (!screenProfile) return { score: 0, reasons: [] };
    const reasons = [];
    let score = 0;

    const { pointerFine, pointerCoarse, pointerNone, maxTouchPoints, rafMean, rafSamples } = screenProfile;
    const ua = (fingerprint && fingerprint.userAgent) ? String(fingerprint.userAgent) : '';
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    // Signal 1 : pointer:none = littéralement aucun dispositif de pointage.
    // Quasi-impossible sur un vrai appareil humain (PC, mobile, tablette).
    // Headless Linux sans X11 renvoie ce signal.
    if (pointerNone === true && !pointerFine && !pointerCoarse) {
        score += SCREEN_POINTER_NONE;
        reasons.push('pointer:none — aucun dispositif de pointage physique (environnement headless)');
    }

    // Signal 2 : UA mobile + pointeur de précision = contradiction physique.
    // Un vrai téléphone/tablette DOIT avoir pointer:coarse (doigt).
    // Un bot qui simule un UA Android a pointer:fine (souris du serveur).
    if (isMobileUA) {
        if (pointerFine === true) {
            score += SCREEN_MOBILE_MISMATCH;
            reasons.push('UA mobile + pointer:fine (souris précise) — UA spoofé, écran physique absent');
        } else if (maxTouchPoints === 0) {
            score += SCREEN_MOBILE_MISMATCH;
            reasons.push('UA mobile + maxTouchPoints=0 — impossible sur appareil tactile réel (UA spoofé)');
        }
    }

    return { score, reasons };
};

// Retourne { score, reasons }
const analyze = ({ webgl, canvas, audio, webgpu, sensorDesync, fingerprint, battery, screenProfile }) => {
    let evidence = 0; // preuves fortes (non plafonnées)
    let absence = 0;  // signaux absents (plafonnés)
    const reasons = [];

    // --- WebGL : modèle du GPU ---
    if (!webgl || webgl.renderer === 'NO_WEBGL' || webgl.renderer === 'WEBGL_ERROR') {
        absence += ABSENCE_PENALTIES.webgl;
        reasons.push('WebGL absent/désactivé (headless OU navigateur vie-privée)');
    } else {
        const renderer = String(webgl.renderer).toLowerCase();
        if (HEADLESS_RENDERERS.some(sig => renderer.includes(sig))) {
            evidence += HEADLESS_RENDERER_PENALTY;
            reasons.push(`Renderer GPU logiciel type headless (${webgl.renderer}) — ou GPU blocklisté chez un humain`);
        } else if (VDI_RENDERERS.some(sig => renderer.includes(sig))) {
            // Plafonné comme l'absence (revue) : sur un poste RDP qui ALSO farble
            // Canvas/Audio (employé Brave en VDI), le renderer VDI non plafonné
            // s'empilait à l'absence et faisait tomber l'humain sous le seuil.
            absence += VDI_RENDERER_PENALTY;
            reasons.push(`Renderer logiciel type VDI/RDP (${webgl.renderer}) — environnement virtualisé`);
        }
    }

    // --- Canvas : rastérisation matérielle ---
    if (!canvas || canvas === 'CANVAS_BLOCKED' || canvas === 'CANVAS_ERROR') {
        absence += ABSENCE_PENALTIES.canvas;
        reasons.push('Canvas bloqué/indisponible');
    }

    // --- AudioContext : pile audio réelle ---
    if (!audio || audio === 'NO_AUDIO' || audio === 'AUDIO_ERROR' || audio === 'AUDIO_TIMEOUT') {
        absence += ABSENCE_PENALTIES.audio;
        reasons.push('AudioContext indisponible');
    }

    // --- Désynchronisation capteurs (≥3 événements à dt < 1ms = injection JS) ---
    if (sensorDesync === true) {
        evidence += SENSOR_DESYNC_PENALTY;
        reasons.push('Désynchronisation matérielle détectée (injection JS)');
    }

    // --- Cohérence basique du fingerprint déclaré ---
    // On ne pénalise QUE le payload vraiment vide (userAgent absent = client cassé
    // ou POST brut). PAS le seul screenResolution manquant (revue) : un mobile en
    // iframe sandbox / certaines API vie-privée ne l'exposent pas — c'est un HUMAIN.
    if (fingerprint && !fingerprint.userAgent) {
        evidence += INCOMPLETE_FP_PENALTY;
        reasons.push('Fingerprint incomplet (userAgent absent)');
    }

    // --- WebGPU : absent sur Chrome ≥113 avec WebGL actif = Camoufox ---
    // Camoufox désactive systématiquement WebGPU (trop complexe à spoofer à
    // niveau source C++). Guard : WebGL doit être fonctionnel pour exclure
    // les environnements headless/sandbox qui n'ont ni l'un ni l'autre.
    if (webgpu === false && fingerprint && fingerprint.userAgent) {
        const uaStr = String(fingerprint.userAgent);
        const m = uaStr.match(/Chrome\/(\d+)/);
        if (m && parseInt(m[1], 10) >= 113 &&
            webgl && webgl.renderer !== 'NO_WEBGL' && webgl.renderer !== 'WEBGL_ERROR') {
            evidence += WEBGPU_ABSENT_PENALTY;
            reasons.push('WebGPU absent sur Chrome ≥113 avec WebGL actif (Camoufox/build patchée)');
        }
    }

    // --- Batterie : level est toujours 0.0-1.0 par spec W3C ---
    // Une valeur > 1.0 (ex. level: 100 → affiché "10000%") = bot qui envoie
    // le mauvais format. Jamais vu sur un vrai navigateur dans nos données.
    if (battery && typeof battery.level === 'number' && battery.level > 1.0) {
        evidence += BATTERY_SPOOF_PENALTY;
        reasons.push(`Batterie spoofée (${Math.round(battery.level * 100)}% — impossible, spec W3C = 0.0-1.0)`);
    }

    // --- Écran physique réel ---
    const screen = analyzeScreen(screenProfile, fingerprint);
    evidence += screen.score;
    reasons.push(...screen.reasons);

    return { score: evidence + Math.max(absence, ABSENCE_CAP), reasons };
};

module.exports = {
    analyze,
    analyzeScreen,
    SOFTWARE_RENDERERS,
    HEADLESS_RENDERERS,
    VDI_RENDERERS,
    ABSENCE_PENALTIES,
    ABSENCE_CAP,
    HEADLESS_RENDERER_PENALTY,
    VDI_RENDERER_PENALTY,
    WEBGPU_ABSENT_PENALTY,
};
