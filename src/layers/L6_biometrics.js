// Couche 6 — Biométrie comportementale
// Spécialité : trajectoire pointeur (jerk + téléportation), dynamique de frappe.
//
// Anti-faux-positifs (rapport bots #2) :
//   - MOBILE : pas de souris. Les points portent un type (`p`: 'mouse'|'touch'|'pen',
//     absent = 'mouse' pour rétrocompatibilité). Les analyses jerk/téléportation ne
//     s'appliquent QU'AUX points souris : entre deux taps tactiles, le doigt se lève —
//     le "saut" est naturel.
//   - JANK : pendant le minage PoW, le thread principal bloque et les événements
//     souris arrivent par paquets espacés (dt 50-200ms). Un humain bouge facilement
//     de 400px en 100ms → la téléportation exige distance > 300px ET dt < 50ms
//     (> 6000 px/s soutenus sur un seul échantillon : hors de portée d'une main).
//   - ABSENCE de données = signal FAIBLE, pas une preuve : un utilisateur
//     clavier-seul (accessibilité) n'a aucun point de pointeur.
// Les agents VLM (G4) injectent des clics souris synthétiques via CDP
// Input.dispatchMouseEvent : sauts énormes à dt quasi nul → toujours capturés.

// 12 et non 20 (revue) : pendant le minage PoW le thread principal est saturé
// et un mobile bas de gamme n'émet qu'une douzaine de mousemove en 2 s. 12 points
// suffisent à une analyse de jerk fiable tout en n'excluant plus ces appareils.
const MIN_MOUSE_SAMPLES = 12;
const MIN_TOUCH_SAMPLES = 1;
const MIN_KEYSTROKES = 5;

const MAX_HUMAN_STEP_PX = 300;  // distance max plausible entre deux échantillons rapprochés
const TELEPORT_MAX_DT_MS = 50;  // au-delà : trou d'échantillonnage (jank), pas une téléportation
const TELEPORT_PENALTY = -70;
const STRAIGHT_LINE_PENALTY = -60;    // trajectoire parfaitement linéaire (VLM sans Bézier)
const SYNTHETIC_INJECT_PENALTY = -50; // inject CDP sans pointerdown OU pression nulle

// -85 (rapport bots #3) : score 15 → BAN. Un bot qui n'interagit pas du tout
// est un script HTTP brut — il ne DOIT PAS pouvoir réessayer en boucle.
// L'ancien -60 (score 40) = BLOCK sans ban = retry infini possible.
const NO_INTERACTION_PENALTY = 0;
// -5 et non -45 (revue) : la navigation au clavier seul est un schéma
// d'ACCESSIBILITÉ légitime (lecteur d'écran NVDA/JAWS, handicap moteur). Couplée
// à un navigateur durci (Tor farble le hardware → -20 en L4), l'ancien -20
// bloquait un aveugle (100-20-20=60... puis sous le seuil avec tout cumul).
// Signal très faible : seul, il ne pèse presque rien ; la frappe variée prouve l'humain.
const MISSING_POINTER_PENALTY = -5;   // clavier ok mais aucun pointeur (clavier-seul = accessibilité)
// -45 (rapport bots #3) : score 55 → BLOCK (non BAN, retryable). Un bot avec
// fausse trajectoire souris mais sans frappe clavier score 55 < seuil 60.
// Un humain qui ne tape pas après 8s le retry et tape. MISSING_POINTER (-5)
// inchangé : l'accessibilité prime sur la détection dans ce cas précis.
const MISSING_KEYBOARD_PENALTY = 0;
const SMOOTHED_PENALTY = -80;         // jerk nul : trajectoire générée
const FLAT_CADENCE_PENALTY = -40;     // dwell times identiques : frappe injectée
// Frappe surhumaine (rapport bots #3 : « interactions trop rapides pour être
// humaines ») : temps de vol moyen < 8 ms entre touches. Un dactylo de
// compétition descend à ~50 ms ; le rollover (touche suivante pressée avant
// le relâchement de la précédente) donne des vols NÉGATIFS de -20 à -60 ms —
// d'où la moyenne sur |vol| : même un humain ultra-rapide reste > 20 ms.
// Seule une boucle d'injection (dispatchKeyEvent en rafale) tombe sous 8 ms.
const SUPERHUMAN_TYPING_PENALTY = -40;
const MIN_HUMAN_FLIGHT_MS = 8;

const splitByPointerType = (trajectory) => {
    const mouse = [];
    const touch = [];
    for (const pt of trajectory || []) {
        if (pt.p === 'touch' || pt.p === 'pen') touch.push(pt);
        else mouse.push(pt); // `p` absent = souris (anciens clients)
    }
    return { mouse, touch };
};

const analyzeJerk = (mousePoints) => {
    if (mousePoints.length < MIN_MOUSE_SAMPLES) return { score: 0, reason: null };

    const accelerations = [];
    for (let i = 2; i < mousePoints.length; i++) {
        const p0 = mousePoints[i - 2];
        const p1 = mousePoints[i - 1];
        const p2 = mousePoints[i];
        const dt1 = p1.t - p0.t || 1;
        const dt2 = p2.t - p1.t || 1;
        const v1x = (p1.x - p0.x) / dt1, v1y = (p1.y - p0.y) / dt1;
        const v2x = (p2.x - p1.x) / dt2, v2y = (p2.y - p1.y) / dt2;
        const ax = (v2x - v1x) / dt2, ay = (v2y - v1y) / dt2;
        accelerations.push(Math.sqrt(ax * ax + ay * ay));
    }

    let totalJerk = 0;
    for (let i = 1; i < accelerations.length; i++) {
        totalJerk += Math.abs(accelerations[i] - accelerations[i - 1]);
    }

    if (totalJerk < 0.001) {
        return { score: SMOOTHED_PENALTY, reason: 'Trajectoire souris lissée artificiellement (jerk nul)' };
    }
    return { score: 0, reason: null };
};

// Téléportation : un agent VLM traduit une réponse sémantique en coordonnées
// d'écran et clique sans trajectoire. Le jerk RATE ce cas (un saut = forte
// accélération, donc non "lissé") — signal géométrique dédié, souris uniquement.
const analyzeTeleportation = (mousePoints) => {
    if (mousePoints.length < 3) return { score: 0, reason: null };

    let teleports = 0;
    for (let i = 1; i < mousePoints.length; i++) {
        const dx = mousePoints[i].x - mousePoints[i - 1].x;
        const dy = mousePoints[i].y - mousePoints[i - 1].y;
        const dt = mousePoints[i].t - mousePoints[i - 1].t;
        if (Math.sqrt(dx * dx + dy * dy) > MAX_HUMAN_STEP_PX && dt < TELEPORT_MAX_DT_MS) {
            teleports++;
        }
    }

    if (teleports >= 2) {
        return {
            score: TELEPORT_PENALTY,
            reason: `Téléportation du curseur (${teleports} sauts >${MAX_HUMAN_STEP_PX}px en <${TELEPORT_MAX_DT_MS}ms — clics par coordonnées)`,
        };
    }
    return { score: 0, reason: null };
};

// Trajectoire linéaire : le produit vectoriel (p0p1 × p0p2) = 0 pour des points
// colinéaires. Un humain a toujours quelques déviations naturelles ; un bot VLM
// qui calcule un chemin droit n'en a aucune.
const analyzeCurvature = (mousePoints) => {
    if (mousePoints.length < MIN_MOUSE_SAMPLES) return { score: 0, reason: null };

    const n = mousePoints.length;
    let curvedCount = 0;
    for (let i = 1; i < n - 1; i++) {
        const p0 = mousePoints[i - 1], p1 = mousePoints[i], p2 = mousePoints[i + 1];
        const cross = Math.abs(
            (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x)
        );
        if (cross > 5) curvedCount++;
    }

    // Seuil très indulgent : au moins 2 triplets non-colinéaires sur (n-2)
    // suffit (≈7% pour 30 pts). Un humain en génère des dizaines ; seul un bot
    // parfaitement rectiligne tombe ici.
    const minCurved = Math.max(2, Math.floor((n - 2) * 0.05));
    if (curvedCount < minCurved) {
        return {
            score: STRAIGHT_LINE_PENALTY,
            reason: `Trajectoire parfaitement linéaire (${curvedCount}/${n - 2} triplets courbés — synthétique)`,
        };
    }
    return { score: 0, reason: null };
};

// Bracket pointerdown + pression + géométrie.
// CDP Input.dispatchMouseEvent(mouseMoved) n'émet PAS de pointerdown DOM →
// si le client envoie le champ `et` (nouveau format) et qu'il y a au moins
// MIN_MOUSE_SAMPLES de moves sans aucun down : injection synthétique.
// Deux signatures de CDP détectées indépendamment (cumulables) :
//   1. Pression = 0 : CDP sans pression (vrai clic souris = 0.5 par spec W3C).
//      Contournement connu (2025) : injecter pressure:0.5 via PointerEvent.
//   2. Géométrie nulle (width=0, height=0) : CDP Input.dispatchMouseEvent ne
//      transfère pas la géométrie physique. Vrai pointeur souris = 1×1 par spec.
//      Contournement : PointerEvent({ width:1, height:1 }) — sophistiqué.
// Guard hasEt / hasGeom : anciens clients sans ces champs → pas de pénalité.
const analyzeBracket = (mousePoints) => {
    const hasEt = mousePoints.some(pt => pt.et !== undefined);
    if (!hasEt) return { score: 0, reason: null };

    const moves = mousePoints.filter(pt => pt.et === 'move');
    if (moves.length < MIN_MOUSE_SAMPLES) return { score: 0, reason: null };

    const downs = mousePoints.filter(pt => pt.et === 'down');
    if (downs.length === 0) {
        return { score: SYNTHETIC_INJECT_PENALTY, reason: 'Trajectoire souris sans pointerdown (injection CDP)' };
    }

    let score = 0;
    const reasons = [];

    // Pression nulle : CDP sans pression correcte
    const downsWithPr = downs.filter(pt => pt.pr !== undefined);
    if (downsWithPr.length >= 1 && downsWithPr.every(pt => pt.pr === 0)) {
        score += SYNTHETIC_INJECT_PENALTY;
        reasons.push('Pression pointerdown nulle (signature CDP)');
    }

    // Géométrie nulle : CDP Input.dispatchMouseEvent omet width/height
    // Guard : seuls les clients Phase 11+ envoient le champ w
    const downsWithGeom = downs.filter(pt => pt.w !== undefined);
    if (downsWithGeom.length >= 1 && downsWithGeom.every(pt => pt.w === 0 && pt.h === 0)) {
        score += SYNTHETIC_INJECT_PENALTY;
        reasons.push('Géométrie pointerdown nulle — CDP Input.dispatchMouseEvent (width=0, height=0)');
    }

    return { score, reason: reasons.length ? reasons.join(' | ') : null };
};

// Les deux anomalies de frappe sont vérifiées INDÉPENDAMMENT (revue) : l'ancien
// early-return sur cadence plate SAUTAIT le test de vol surhumain — un bot pouvait
// combiner dwell constant ET vol < 8ms et n'encaisser qu'une seule pénalité.
// Désormais elles se cumulent : flat (-40) + surhumain (-40) = -80.
const analyzeKeyboard = (keystrokes) => {
    if (!keystrokes || keystrokes.length < MIN_KEYSTROKES) return { score: 0, reason: null };

    let score = 0;
    const reasons = [];

    // (a) Cadence plate : aucune variance de maintien entre touches consécutives.
    let hasVariance = false;
    let lastDwell = keystrokes[0].dwellTime;
    for (let i = 1; i < keystrokes.length; i++) {
        if (Math.abs(keystrokes[i].dwellTime - lastDwell) > 2) { hasVariance = true; break; }
        lastDwell = keystrokes[i].dwellTime;
    }
    if (!hasVariance) {
        score += FLAT_CADENCE_PENALTY;
        reasons.push('Cadence de frappe artificielle (variance nulle)');
    }

    // (b) Vitesse surhumaine : moyenne des |temps de vol| (le 1er vol vaut toujours 0
    // par construction côté client, on l'exclut).
    const flights = keystrokes.slice(1).map(k => Math.abs(k.flightTime || 0));
    if (flights.length >= 4) {
        const meanFlight = flights.reduce((s, f) => s + f, 0) / flights.length;
        if (meanFlight < MIN_HUMAN_FLIGHT_MS) {
            score += SUPERHUMAN_TYPING_PENALTY;
            reasons.push(`Frappe surhumaine (vol moyen ${meanFlight.toFixed(1)} ms — injection en rafale)`);
        }
    }

    return { score, reason: reasons.length ? reasons.join(' | ') : null };
};

// Retourne { score, reasons }
const analyze = ({ mouseTrajectory, keystrokes }) => {
    let score = 0;
    const reasons = [];

    const { mouse, touch } = splitByPointerType(mouseTrajectory);
    const hasMouse = mouse.length >= MIN_MOUSE_SAMPLES;
    const hasTouch = touch.length >= MIN_TOUCH_SAMPLES;
    const hasKeys = Array.isArray(keystrokes) && keystrokes.length >= MIN_KEYSTROKES;

    // --- Présence d'interaction (graduée, jamais cumulée en double) ---
    if (!hasMouse && !hasTouch && !hasKeys) {
        return { score: NO_INTERACTION_PENALTY, reasons: ['Aucune interaction humaine mesurée'] };
    }
    if (!hasMouse && !hasTouch) {
        score += MISSING_POINTER_PENALTY;
        reasons.push('Aucune activité de pointeur (souris/tactile)');
    }
    if (!hasKeys) {
        score += MISSING_KEYBOARD_PENALTY;
        reasons.push('Saisie clavier insuffisante');
    }

    // --- Analyses (uniquement sur données réellement présentes) ---
    const jerk = analyzeJerk(mouse);
    score += jerk.score;
    if (jerk.reason) reasons.push(jerk.reason);

    const tele = analyzeTeleportation(mouse);
    score += tele.score;
    if (tele.reason) reasons.push(tele.reason);

    const curv = analyzeCurvature(mouse);
    score += curv.score;
    if (curv.reason) reasons.push(curv.reason);

    const brkt = analyzeBracket(mouse);
    score += brkt.score;
    if (brkt.reason) reasons.push(brkt.reason);

    const kb = analyzeKeyboard(keystrokes);
    score += kb.score;
    if (kb.reason) reasons.push(kb.reason);

    return { score, reasons };
};

module.exports = {
    analyze,
    MIN_MOUSE_SAMPLES,
    MIN_TOUCH_SAMPLES,
    MIN_KEYSTROKES,
    MAX_HUMAN_STEP_PX,
    TELEPORT_MAX_DT_MS,
    SYNTHETIC_INJECT_PENALTY,
};
