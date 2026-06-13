const express = require('express');
const router  = express.Router();
const config  = require('../config');

const { getSuspicion, getSessionSeed, getLane } = require('../middlewares/prismAdapter');
const { refract, currentEpoch, honeypot, frictionMs, fragmentField } = require('../../prism-sdk');

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
    const payload = (reality === 'decoy' || reality === 'watermarked')
        ? honeypot.injectHoneypot(fragmented, seed)
        : fragmented;

    res.json({
        lane:         getLane(req),
        suspicion:    parseFloat(getSuspicion(req).toFixed(2)),
        data:         payload,
        revealStyles,
        reality,
    });
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
