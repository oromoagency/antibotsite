/**
 * captureWatermark.js — Stéganographie défensive de CAPTURE (traceur post-fuite)
 *
 * Ce module n'EMPÊCHE PAS le screenshot (aucun truc client ne bloque un
 * page.screenshot() en headless moderne — cf. recherche adverse). Il TRACE : il
 * encode l'empreinte de session (seed + époque) dans une bande visuelle déterministe
 * rendue sous le tableau de données pour les réalités dégradées (watermarked/decoy).
 * Si un opérateur capture l'écran puis republie l'image, la marque SURVIT au pixel
 * (et même au « analog hole » : photo de l'écran) → on retrouve la session fuiteuse,
 * là où le watermark JSON disparaît dès qu'on passe par l'image.
 *
 * Doctrine : c'est un canal de TRAÇABILITÉ, pas une dégradation ni un verdict. Il ne
 * lit aucun signal, ne classe personne, ne s'applique JAMAIS à un humain 'normal'.
 *
 * Trois blocages levés par rapport à la conception initiale :
 *   1. Conflit OCR jamming : la bande est une COUCHE SÉPARÉE (sibling du tableau),
 *      hors du sous-arbre filtré par #ocr-scramble → le feDisplacementMap ne la touche pas.
 *   2. Décodeur : decodeWatermark()/decodeStripPixels() relisent l'empreinte depuis une
 *      image (zéro dépendance — opère sur un tableau de pixels RGBA).
 *   3. Robustesse honnête : amplitude ASSUMÉE (pas « imperceptible »), code à RÉPÉTITION
 *      + checksum → vote majoritaire tolérant au bruit ET zéro fausse attribution
 *      (un screenshot quelconque/bruit aléatoire décode valid:false).
 *
 * Enveloppe de robustesse : conçu pour survivre à un screenshot PNG direct et à une
 * recompression légère. Une recompression JPEG agressive / un redimensionnement fort
 * peuvent détruire le canal — c'est un filet de DERNIER recours, pas une garantie.
 */

const { hashInt, currentEpoch } = require('./refractor');

// ─── Paramètres du canal ──────────────────────────────────────────────────────
const N_PAYLOAD_BITS = 16;                 // id de session par époque (65 536 valeurs)
const N_CHECK_BITS   = 8;                   // checksum anti-fausse-attribution
const WORD_BITS      = N_PAYLOAD_BITS + N_CHECK_BITS; // 24
const REPEAT         = 5;                   // code à répétition (vote majoritaire, tolère 1 copie entièrement corrompue)
const N_CELLS        = WORD_BITS * REPEAT;  // 72 cellules
const STRIP_H        = 8;                   // hauteur de la bande (px)
const BASE_L         = 44;                  // luminance de base (sombre, colle au thème)
const DELTA_L        = 16;                  // ± luminance par bit (séparable, discret)
const ELEMENT_ID     = 'prism-capture-wm';
const MIN_CONFIDENCE = 0.75;               // accord min entre copies pour valider

// ─── Empreinte de session (16 bits déterministes par seed + époque) ───────────
function sessionWatermarkId(seed, epoch) {
    const ep = epoch || currentEpoch();
    return (hashInt(String(seed) + '|capwm|' + ep) & 0xFFFF) >>> 0;
}

// Checksum 8 bits déterministe — détecte un décodage erroné (zéro fausse attribution).
function checksum8(id16) {
    const hi = (id16 >>> 8) & 0xFF;
    const lo = id16 & 0xFF;
    let c = (hi ^ lo) & 0xFF;
    c = ((c << 1) | (c >>> 7)) & 0xFF;     // rotation pour casser la linéarité
    return (c ^ 0x5A) & 0xFF;
}

// 24 bits = id(16) | checksum(8), MSB d'abord.
function wordBits(id16) {
    const word = ((id16 & 0xFFFF) << 8) | checksum8(id16 & 0xFFFF);
    const bits = [];
    for (let i = WORD_BITS - 1; i >= 0; i--) bits.push((word >>> i) & 1);
    return bits;
}

// ─── ENCODEUR ─────────────────────────────────────────────────────────────────
// Renvoie la bande sous forme de CSS (gradient à blocs francs) + métadonnées.
// La largeur est en % (background-size:100%) : la bande s'adapte à la largeur de
// rendu, et le décodeur échantillonne N_CELLS colonnes uniformément — donc l'échelle
// d'affichage n'affecte pas le décodage.
function encodeWatermark(seed, epoch) {
    const ep   = epoch || currentEpoch();
    const id   = sessionWatermarkId(seed, ep);
    const unit = wordBits(id);                              // 24 bits
    const bits = [];
    for (let r = 0; r < REPEAT; r++) bits.push(...unit);   // N_CELLS bits

    const stops = bits.map((b, i) => {
        const L = BASE_L + (b ? DELTA_L : -DELTA_L);
        const x0 = ((i / bits.length) * 100).toFixed(4);
        const x1 = (((i + 1) / bits.length) * 100).toFixed(4);
        return `rgb(${L},${L},${L}) ${x0}% ${x1}%`;
    });
    const gradient = `linear-gradient(90deg, ${stops.join(', ')})`;

    // Bande discrète SOUS le tableau (couche séparée, hors filtre OCR). Statique →
    // aucun flash (WCAG 2.3.1 N/A). Hors texte → aucun impact contraste (WCAG 1.4.3).
    const css =
        `#${ELEMENT_ID}{display:block;width:100%;height:${STRIP_H}px;` +
        `margin:10px 0 0;border-radius:3px;opacity:0.6;` +
        `background-image:${gradient};background-size:100% 100%;background-repeat:no-repeat;` +
        `pointer-events:none;}`;

    return { id, epoch: ep, bits, nCells: N_CELLS, height: STRIP_H, elementId: ELEMENT_ID, css };
}

// Seuil bimodal robuste (2-means 1D) : sépare les deux niveaux (bit 0 / bit 1) quel
// que soit le déséquilibre du mot — contrairement à une simple moyenne, qui dérape si
// le mot contient une forte majorité de 0 ou de 1. Sur un niveau unique (dégénéré),
// renvoie un seuil au-dessus de toutes les valeurs → tout décode à 0 (→ checksum KO).
function bimodalThreshold(vals) {
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-6) return lo + 0.5;        // niveau unique → rien au-dessus du seuil
    let c0 = lo, c1 = hi;
    for (let it = 0; it < 10; it++) {
        let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
        for (const v of vals) {
            if (Math.abs(v - c0) <= Math.abs(v - c1)) { s0 += v; n0++; }
            else { s1 += v; n1++; }
        }
        const nc0 = n0 ? s0 / n0 : c0;
        const nc1 = n1 ? s1 / n1 : c1;
        if (Math.abs(nc0 - c0) < 1e-6 && Math.abs(nc1 - c1) < 1e-6) { c0 = nc0; c1 = nc1; break; }
        c0 = nc0; c1 = nc1;
    }
    return (c0 + c1) / 2;
}

// ─── DÉCODEUR ─────────────────────────────────────────────────────────────────
// Entrée : luminances mesurées par cellule (longueur = multiple de WORD_BITS).
// Sortie : { valid, id, confidence, bits }. valid:false sur bruit/random (checksum +
// accord des copies) → JAMAIS d'attribution erronée d'une fuite à une session réelle.
function decodeWatermark(luminances) {
    if (!Array.isArray(luminances) || luminances.length < WORD_BITS) {
        return { valid: false, id: null, confidence: 0, bits: [] };
    }
    const rep = Math.floor(luminances.length / WORD_BITS);
    if (rep < 1) return { valid: false, id: null, confidence: 0, bits: [] };
    const used = luminances.slice(0, rep * WORD_BITS);

    // Seuil bimodal (2 niveaux) — robuste au déséquilibre du mot et à un décalage global.
    const threshold = bimodalThreshold(used);
    const rawBits = used.map((l) => (l > threshold ? 1 : 0));

    // Vote majoritaire sur les `rep` copies de chaque position + mesure d'accord.
    const folded = [];
    let agreementSum = 0;
    for (let pos = 0; pos < WORD_BITS; pos++) {
        let ones = 0;
        for (let r = 0; r < rep; r++) ones += rawBits[pos + r * WORD_BITS];
        const bit = ones * 2 >= rep ? 1 : 0;
        const agree = Math.max(ones, rep - ones) / rep;
        agreementSum += agree;
        folded.push(bit);
    }
    const confidence = agreementSum / WORD_BITS;

    let word = 0;
    for (const b of folded) word = (word << 1) | b;
    const id  = (word >>> 8) & 0xFFFF;
    const chk = word & 0xFF;
    const valid = checksum8(id) === chk && confidence >= MIN_CONFIDENCE;

    return { valid, id: valid ? id : null, confidence: parseFloat(confidence.toFixed(3)), bits: folded };
}

// ─── DÉCODEUR PAR COLONNES ────────────────────────────────────────────────────
// Entrée : `columns` = luminances par colonne de pixels de la bande recadrée (longueur
// quelconque ≥ N_CELLS). Le serveur RÉÉCHANTILLONNE en N_CELLS cellules (médiane par
// groupe) puis décode. Ainsi le client (admin) n'a pas besoin de connaître N_CELLS :
// il envoie l'échantillonnage brut, le serveur fait l'alignement. Découplage volontaire.
function decodeColumns(columns) {
    if (!Array.isArray(columns)) return { valid: false, id: null, confidence: 0, bits: [] };
    // Déjà aligné sur les cellules (multiple de WORD_BITS) → décodage direct.
    if (columns.length >= WORD_BITS && columns.length % WORD_BITS === 0 && columns.length <= N_CELLS) {
        return decodeWatermark(columns);
    }
    if (columns.length < N_CELLS) return { valid: false, id: null, confidence: 0, bits: [] };

    const lums = [];
    for (let c = 0; c < N_CELLS; c++) {
        const s = Math.floor((c / N_CELLS) * columns.length);
        const e = Math.max(s + 1, Math.floor(((c + 1) / N_CELLS) * columns.length));
        const slice = columns.slice(s, e).sort((a, b) => a - b);
        lums.push(slice[Math.floor(slice.length / 2)]);
    }
    return decodeWatermark(lums);
}

// ─── DÉCODEUR IMAGE ───────────────────────────────────────────────────────────
// Entrée : { width, height, data } où data = Uint8/Array RGBA (4 octets/pixel), une
// image RECADRÉE sur la bande de watermark. Échantillonne nCells colonnes uniformes
// (luminance médiane d'une bande centrale) puis décode. Zéro dépendance image.
function decodeStripPixels(image, nCells = N_CELLS) {
    if (!image || !image.data || !image.width || !image.height) {
        return { valid: false, id: null, confidence: 0, bits: [] };
    }
    const { width, height, data } = image;
    const y0 = Math.floor(height * 0.25);
    const y1 = Math.max(y0 + 1, Math.floor(height * 0.75));
    const luminances = [];

    for (let c = 0; c < nCells; c++) {
        const xStart = Math.floor((c / nCells) * width);
        const xEnd   = Math.max(xStart + 1, Math.floor(((c + 1) / nCells) * width));
        const samples = [];
        for (let y = y0; y < y1; y++) {
            for (let x = xStart; x < xEnd; x++) {
                const idx = (y * width + x) * 4;
                const L = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                samples.push(L);
            }
        }
        samples.sort((a, b) => a - b);
        luminances.push(samples.length ? samples[Math.floor(samples.length / 2)] : 0); // médiane
    }
    return decodeWatermark(luminances);
}

module.exports = {
    sessionWatermarkId,
    encodeWatermark,
    decodeWatermark,
    decodeColumns,
    decodeStripPixels,
    // constantes utiles au décodeur image / aux tests
    N_CELLS,
    WORD_BITS,
    REPEAT,
    STRIP_H,
    ELEMENT_ID,
    BASE_L,
    DELTA_L,
};
