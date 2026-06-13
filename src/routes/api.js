const express = require('express');
const router  = express.Router();
const config  = require('../config');

const { getSuspicion, getSessionSeed, getLane } = require('../middlewares/prismAdapter');
const {
    refract, currentEpoch, honeypot, frictionMs, fragmentField,
    encodeWatermark, decodeWatermark, decodeColumns, sessionWatermarkId, sessionStore,
} = require('../../prism-sdk');

// Intensité du poison agrégat selon la réalité décidée à la gate (qui circule
// désormais jusqu'ici). Une session 'decoy' (hostile confirmée) reçoit des
// agrégats très faux ; les autres, le poison standard traçable.
const poisonFactorFor = (reality) => (reality === 'decoy' ? 4 : 1);

// ─── Politique de réfraction des données de démo ─────────────────────────────
// Doctrine Prisme : je ne renvoie JAMAIS data. Je renvoie refract(data, seed).
// Même pour un humain validé — le watermark est là pour tracer une fuite, pas bloquer.
const DEMO_POLICY = {
    id:          'actionable',
    name:        'actionable',
    region:      'actionable',
    uptime:      'actionable',
    price:       'actionable',  // exact, mais servi via révélation progressive (cf. plus bas)
    endpoint:    'cosmetic',
    description: 'cosmetic',
    requests:    'aggregate',
    latency_ms:  'aggregate',
    errorRate:   'aggregate',
};

const DEMO_DATASET = [
    { id: 'svc-1', name: 'Core API',     region: 'eu-west',  endpoint: '/api/v1',        description: 'Service robuste et securise',   requests: 2048341, latency_ms: 12, errorRate: 0.02, uptime: '99.98%', price: 49.99 },
    { id: 'svc-2', name: 'Analytics',    region: 'us-east',  endpoint: '/api/analytics', description: 'Moteur avance et performant',    requests: 891234,  latency_ms: 8,  errorRate: 0.01, uptime: '99.99%', price: 19.00 },
    { id: 'svc-3', name: 'Auth Service', region: 'ap-south', endpoint: '/api/auth',      description: 'Systeme precis et moderne',      requests: 456789,  latency_ms: 15, errorRate: 0.03, uptime: '99.95%', price: 99.50 },
    { id: 'svc-4', name: 'Gateway',      region: 'eu-west',  endpoint: '/api/gateway',   description: 'Routeur intelligent et leger',   requests: 3201045, latency_ms: 6,  errorRate: 0.00, uptime: '100%',   price: 149.99 },
];

// GET /api/prism/status
router.get('/prism/status', (req, res) => {
    const suspicion    = getSuspicion(req);
    const sessionSeed  = getSessionSeed(req);
    const lane         = getLane(req);
    const reality      = req.visitor?.prisme?.reality || 'unknown';
    res.json({
        suspicion:   parseFloat(suspicion.toFixed(2)),
        lane,
        reality,
        frictionMs:  Math.round(frictionMs(suspicion)),
        sessionSeed: sessionSeed.slice(0, 8) + '…',
    });
});

// GET /api/prism/demo — données toujours réfractées (watermark + poison)
router.get('/prism/demo', async (req, res) => {
    const seed    = getSessionSeed(req);
    const epoch   = currentEpoch();
    const reality = req.visitor?.prisme?.reality || 'normal';

    const refracted = refract(DEMO_DATASET, DEMO_POLICY, seed, epoch, { poisonFactor: poisonFactorFor(reality) });

    // Révélation progressive : le prix (actionable, donc exact) est fragmenté — partie
    // entière dans le JSON, centièmes dans une variable CSS que SEUL un navigateur
    // assemble. Un extracteur JSON naïf ne lit que l'entier (49 au lieu de 49.99).
    const { rows: fragmented, styles: revealStyles } = fragmentField(refracted, 'price');

    // Ajouter honeypot seulement pour les sessions suspectes
    const degraded = (reality === 'decoy' || reality === 'watermarked');
    const payload  = degraded ? honeypot.injectHoneypot(fragmented, seed) : fragmented;

    // Watermark de CAPTURE (traçabilité post-fuite) : pour les réalités dégradées,
    // on émet une bande visuelle déterministe (empreinte seed+époque) rendue SOUS le
    // tableau, en COUCHE SÉPARÉE du filtre OCR. Elle survit à un screenshot/photo de
    // l'écran → on retrouve la session fuiteuse. Ne s'applique JAMAIS à 'normal'.
    const captureWatermark = degraded
        ? (() => { const w = encodeWatermark(seed, epoch); return { css: w.css, elementId: w.elementId }; })()
        : null;

    res.json({
        lane:         getLane(req),
        suspicion:    parseFloat(getSuspicion(req).toFixed(2)),
        data:         payload,
        revealStyles,
        captureWatermark,
        reality,
    });
});

// POST /api/admin/decode-watermark — outil forensics : décode l'empreinte de capture
// depuis les luminances échantillonnées d'un screenshot (par l'admin) et relie l'id
// décodé à une session active. Porte = token admin (le Shield laisse passer sur token).
router.post('/admin/decode-watermark', (req, res) => {
    const tok = req.headers['x-admin-token'];
    if (!config.ADMIN_TOKEN || tok !== config.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'admin_token_required' });
    }
    const { luminances, columns } = req.body || {};
    let decoded;
    if (Array.isArray(columns)) {
        decoded = decodeColumns(columns.map(Number));        // brut → le serveur rééchantillonne
    } else if (Array.isArray(luminances)) {
        decoded = decodeWatermark(luminances.map(Number));   // déjà aligné sur les cellules
    } else {
        return res.status(400).json({ error: 'columns_or_luminances_array_required' });
    }
    const epoch = (req.body && typeof req.body.epoch === 'string') ? req.body.epoch : currentEpoch();

    if (!decoded.valid) {
        return res.json({ valid: false, id: null, confidence: decoded.confidence, epoch, matches: [] });
    }

    // Relier l'id décodé à une session active (les deux seeds possibles : seed durable
    // du JWT et seed interne). Indicatif — l'id reste une preuve même sans match vivant.
    const matches = [];
    for (const s of sessionStore.listSessions()) {
        const seeds = [s.prisme && s.prisme.sessionSeed, s.internalSeed].filter(Boolean);
        if (seeds.some((seed) => sessionWatermarkId(seed, epoch) === decoded.id)) {
            matches.push({
                id:       s.id,
                reality:  (s.prisme && s.prisme.reality) || 'unknown',
                lastSeen: new Date(s.lastSeenAt).toISOString(),
            });
        }
    }

    res.json({ valid: true, id: decoded.id, confidence: decoded.confidence, epoch, matches });
});

// GET /api/demo/v1/metrics — réfracté
const METRICS_POLICY = {
    id:          'actionable',
    requests:    'aggregate',
    latency_ms:  'aggregate',
    uptime:      'actionable',
    region:      'actionable',
    description: 'cosmetic',
};
router.get('/demo/v1/metrics', async (req, res) => {
    const seed    = getSessionSeed(req);
    const epoch   = currentEpoch();
    const reality = req.visitor?.prisme?.reality || 'normal';
    const raw     = [{ id: 'metrics', requests: 2048341, latency_ms: 12, uptime: '99.98%', region: 'eu-west', description: 'Service robuste' }];
    const [item]  = refract(raw, METRICS_POLICY, seed, epoch, { poisonFactor: poisonFactorFor(reality) });
    res.json(item);
});

// GET /api/demo/v1/users — réfracté
const USERS_POLICY = {
    id:    'actionable',
    name:  'cosmetic',
    role:  'actionable',
    email: 'cosmetic',
};
const USERS_DATASET = [
    { id: 1, name: 'Jean Dupont',   role: 'admin',     email: 'j.dupont@nexapi.io' },
    { id: 2, name: 'Marie Lambert', role: 'developer', email: 'm.lambert@nexapi.io' },
    { id: 3, name: 'Alex Torres',   role: 'analyst',   email: 'a.torres@nexapi.io' },
];
router.get('/demo/v1/users', async (req, res) => {
    const seed    = getSessionSeed(req);
    const epoch   = currentEpoch();
    const reality = req.visitor?.prisme?.reality || 'normal';
    const data    = refract(USERS_DATASET, USERS_POLICY, seed, epoch, { poisonFactor: poisonFactorFor(reality) });
    const payload = (reality === 'decoy' || reality === 'watermarked')
        ? honeypot.injectHoneypot(data, seed)
        : data;
    res.json({ data: payload, meta: { total: data.length } });
});

module.exports = router;
