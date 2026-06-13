const express = require('express');
const router  = express.Router();
const config  = require('../config');

const validationController = require('../controllers/validationController');
const adminController      = require('../controllers/adminController');
const trackingController   = require('../controllers/trackingController');
const telegramController   = require('../controllers/telegramController');
const L7_session           = require('../layers/L7_session');
const antibotEntry         = require('../antibot/middleware/antibotEntry');
const { refract, currentEpoch } = require('../../prism-sdk/src/server/refractor');
const { getSuspicion, getSessionSeed, getLane } = require('../middlewares/prismAdapter');
const { frictionMs } = require('../../prism-sdk/src/server/suspicion');
const honeypot = require('../../prism-sdk/src/server/honeypot');

// ─── Routes publiques (avant tout gate) ───────────────────────────────────────
router.get('/challenge-config',    validationController.getChallengeConfig);
router.post('/verify-challenge',   validationController.verifyChallenge);
router.post('/feedback-invisible', validationController.recordSilentFeedback);
router.post('/track/event',        trackingController.recordEvent);
router.post('/auth/login',         trackingController.recordLoginAttempt);
router.post('/auth/register',      trackingController.recordRegister);

// La voie sans JS a été supprimée (Zero Bot Mode strict).
// Un client sans JavaScript ne peut plus contourner le PoW.

// ─── Honeypot invisible ───────────────────────────────────────────────────────
router.use('/__internal/v2/stats', honeypot.honeypotTrapMiddleware);

// ─── Attacher la session causal à req.visitor (Zero Bot pipeline) ─────────────
// Positionné ICI (après les routes publiques) pour que challenge-config et
// verify-challenge ne soient pas ralentis par la création de session inutile.
router.use(antibotEntry);

// ─── Gate API : session humaine validée requise ───────────────────────────────
// Deux chemins valides :
//   1. human_auth_token JWT valide (posé par verify-challenge après PoW réussi)
//   2. req.visitor.humanValidated (session causal si pipeline actif)
// Exception : token admin valide passe directement.
const requireHumanApi = (req, res, next) => {
    // Admin bypass — vérifie x-admin-token avant tout
    const adminToken = req.headers['x-admin-token'];
    if (adminToken && config.ADMIN_TOKEN && adminToken === config.ADMIN_TOKEN) {
        return next();
    }

    // Chemin 1 : JWT L7 posé par verifyChallenge (flux principal)
    const jwtResult = L7_session.verifyToken(req.cookies['human_auth_token']);
    if (jwtResult.valid) return next();

    // Chemin 2 : session causal (fallback si antibotEntry a chargé la session)
    if (req.visitor?.humanValidated) return next();

    return res.status(401).json({ error: 'human_session_required' });
};

router.use(requireHumanApi);

// ─── Politique de réfraction des données de démo ─────────────────────────────
// Doctrine Prisme : je ne renvoie JAMAIS data. Je renvoie refract(data, seed).
// Même pour un humain validé — le watermark est là pour tracer une fuite, pas bloquer.
const DEMO_POLICY = {
    id:          'actionable',
    name:        'actionable',
    region:      'actionable',
    uptime:      'actionable',
    endpoint:    'cosmetic',
    description: 'cosmetic',
    requests:    'aggregate',
    latency_ms:  'aggregate',
    errorRate:   'aggregate',
};

const DEMO_DATASET = [
    { id: 'svc-1', name: 'Core API',     region: 'eu-west',  endpoint: '/api/v1',        description: 'Service robuste et securise',   requests: 2048341, latency_ms: 12, errorRate: 0.02, uptime: '99.98%' },
    { id: 'svc-2', name: 'Analytics',    region: 'us-east',  endpoint: '/api/analytics', description: 'Moteur avance et performant',    requests: 891234,  latency_ms: 8,  errorRate: 0.01, uptime: '99.99%' },
    { id: 'svc-3', name: 'Auth Service', region: 'ap-south', endpoint: '/api/auth',      description: 'Systeme precis et moderne',      requests: 456789,  latency_ms: 15, errorRate: 0.03, uptime: '99.95%' },
    { id: 'svc-4', name: 'Gateway',      region: 'eu-west',  endpoint: '/api/gateway',   description: 'Routeur intelligent et leger',   requests: 3201045, latency_ms: 6,  errorRate: 0.00, uptime: '100%'   },
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

    const data = refract(DEMO_DATASET, DEMO_POLICY, seed, epoch);

    // Ajouter honeypot seulement pour les sessions suspectes
    const payload = (reality === 'decoy' || reality === 'watermarked')
        ? honeypot.injectHoneypot(data, seed)
        : data;

    res.json({
        lane:      getLane(req),
        suspicion: parseFloat(getSuspicion(req).toFixed(2)),
        data:      payload,
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
    const seed  = getSessionSeed(req);
    const epoch = currentEpoch();
    const raw   = [{ id: 'metrics', requests: 2048341, latency_ms: 12, uptime: '99.98%', region: 'eu-west', description: 'Service robuste' }];
    const [item] = refract(raw, METRICS_POLICY, seed, epoch);
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
    const seed  = getSessionSeed(req);
    const epoch = currentEpoch();
    const data  = refract(USERS_DATASET, USERS_POLICY, seed, epoch);
    const reality = req.visitor?.prisme?.reality || 'normal';
    const payload = (reality === 'decoy' || reality === 'watermarked')
        ? honeypot.injectHoneypot(data, seed)
        : data;
    res.json({ data: payload, meta: { total: data.length } });
});

// ─── Admin dashboard ──────────────────────────────────────────────────────────
router.get('/admin/stats',        adminController.getStats);
router.get('/admin/report',       adminController.getFullReport);
router.get('/admin/visitors',     trackingController.getVisitors);
router.get('/admin/visitor/:id',  trackingController.getVisitorById);
router.get('/admin/logs',         trackingController.getLogs);
router.post('/admin/telegram',    telegramController.sendReport);

module.exports = router;
