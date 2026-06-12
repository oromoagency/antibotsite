const express = require('express');
const router = express.Router();
const validationController = require('../controllers/validationController');
const adminController      = require('../controllers/adminController');
const trackingController   = require('../controllers/trackingController');
const telegramController   = require('../controllers/telegramController');
const L7_session           = require('../layers/L7_session');
const { refract, currentEpoch } = require('../prism/refractor');
const { toSuspicion, frictionMs, chooseLane, delay, getSuspicion, getSessionSeed, getLane } = require('../prism/suspicion');
const visitors = require('../store/visitors');

// --- Antibot pipeline ---
router.get('/challenge-config',    validationController.getChallengeConfig);
router.post('/verify-challenge',   validationController.verifyChallenge);
router.post('/feedback-invisible', validationController.recordSilentFeedback);

// --- Écart 1 FIX : Voie accessible pour humains sans JavaScript (Guide §5 & §7) ---
// Si le PoW ne peut pas s'exécuter (JS désactivé), la gateway redirige ici via <noscript>.
// On émet un token dégradé (suspicion 1.0, lane accessible) SANS exiger le PoW.
// Invariant : un humain sans JS peut toujours terminer sa tâche — jamais de page blanche.
// Sécurité : un bot qui contourne JS peut aussi trouver cette route.
//   → Ce n'est pas grave : il reçoit suspicion 1.0 = friction max + data réfractée.
//   → Le guide dit explicitement qu'une voie accessible doit exister pour les clients sans rendu.
router.get('/noscript-entry', (req, res) => {
    const ip   = req.ip || 'unknown';
    const seed = 'noscript-' + ip; // seed stable par IP — traçable même sans sessionSeed
    // Token dégradé : trustScore=0, suspicion=1.0, voie accessible
    const token = L7_session.createToken(ip, { noscript: true }, 0, 1.0, seed);
    console.log(`[PRISM] Voie accessible émise (noscript) pour IP: ${ip}`);
    res.cookie('human_auth_token', token, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   L7_session.SESSION_DURATION_MS,
    });
    // Redirige vers la landing — requireHuman verra le token valide
    res.redirect('/');
});

// --- Tracking client-side events ---
router.post('/track/event', trackingController.recordEvent);

// --- Auth endpoints (honeypots pour bots credential stuffing) ---
router.post('/auth/login',    trackingController.recordLoginAttempt);
router.post('/auth/register', trackingController.recordRegister);

// --- Fausse API publique (attire les scrapers — données réfractées) ---
// Ces routes SEMBLENT exposer des données sensibles mais retournent toujours refract(data).
// Un scraper récolte des données filigranées (traçables) et empoisonnées (agrégat inutilisable).
const DEMO_POLICY = {
    id:          'actionable',
    name:        'actionable',
    region:      'actionable',
    uptime:      'actionable',   // donnée contractuelle : intouchable
    endpoint:    'cosmetic',     // filigranable — trace la session source si ça fuite
    description: 'cosmetic',
    requests:    'aggregate',    // empoisonnable — casse les datasets de veille concurrentielle
    latency_ms:  'aggregate',
    errorRate:   'aggregate',
};

const DEMO_DATASET = [
    { id: 'svc-1', name: 'Core API',     region: 'eu-west',  endpoint: '/api/v1',      description: 'Service robuste et sécurisé',      requests: 2048341, latency_ms: 12, errorRate: 0.02, uptime: '99.98%' },
    { id: 'svc-2', name: 'Analytics',    region: 'us-east',  endpoint: '/api/analytics', description: 'Moteur avancé et performant',       requests: 891234,  latency_ms: 8,  errorRate: 0.01, uptime: '99.99%' },
    { id: 'svc-3', name: 'Auth Service', region: 'ap-south', endpoint: '/api/auth',    description: 'Système précis et moderne',          requests: 456789,  latency_ms: 15, errorRate: 0.03, uptime: '99.95%' },
    { id: 'svc-4', name: 'Gateway',      region: 'eu-west',  endpoint: '/api/gateway', description: 'Routeur intelligent et léger',       requests: 3201045, latency_ms: 6,  errorRate: 0.00, uptime: '100%'   },
];

// GET /api/prism/status — état de la session courante (suspicion + voie)
router.get('/prism/status', (req, res) => {
    const suspicion = getSuspicion(req, visitors);
    const sessionSeed = getSessionSeed(req, visitors);
    const lane = getLane(req);
    res.json({
        suspicion:   parseFloat(suspicion.toFixed(2)),
        lane,
        frictionMs:  Math.round(frictionMs(suspicion)),
        sessionSeed: sessionSeed.slice(0, 8) + '…', // tronqué — utile pour le debug, non secret
    });
});

// GET /api/prism/demo — données de démo réfractées (jamais de data brut)
router.get('/prism/demo', async (req, res) => {
    const suspicion   = getSuspicion(req, visitors);
    const sessionSeed = getSessionSeed(req, visitors);
    const lane        = getLane(req);

    // Friction graduée — jamais un refus, toujours une réponse
    await delay(frictionMs(suspicion));

    // Règle 2 : on ne renvoie JAMAIS data brut — toujours refract(data, …)
    const data = refract(DEMO_DATASET, DEMO_POLICY, sessionSeed, currentEpoch());

    res.json({ lane, suspicion: parseFloat(suspicion.toFixed(2)), data });
});

// --- Fake demo API (anciens endpoints — conservés, maintenant réfractés) ---
router.get('/demo/v1/users',   (req, res) => res.json({ data: [{ id: 1, name: 'John Doe', role: 'admin' }], meta: { total: 1 } }));
router.get('/demo/v1/metrics', async (req, res) => {
    const suspicion   = getSuspicion(req, visitors);
    const sessionSeed = getSessionSeed(req, visitors);
    await delay(frictionMs(suspicion));
    const [item] = refract(
        [{ id: 'metrics', requests: 2048341, latency_ms: 12, uptime: '99.98%', region: 'eu-west', description: 'Service robuste' }],
        { id: 'actionable', requests: 'aggregate', latency_ms: 'aggregate', uptime: 'actionable', region: 'actionable', description: 'cosmetic' },
        sessionSeed, currentEpoch()
    );
    res.json(item);
});
// --- Écarts 2 & 3 FIX : /demo/v1/users réfracté, /demo/v1/keys supprimé (surface inutile) ---
// Guide §4 Règle 2 : aucun handler ne renvoie data brut.
// Guide L0 §3 : pas d'API JSON publique avec surface réelle — /demo/v1/keys retournait 401
//   mais existait comme route; la supprimer réduit la surface sans impact UX.
const USERS_POLICY = {
    id:    'actionable',  // clé technique : intouchable
    name:  'cosmetic',   // filigranable — trace si ça fuite
    role:  'actionable', // donnée contractuelle (admin/dev) : jamais altérée
    email: 'cosmetic',   // filigranable par session
};
const USERS_DATASET = [
    { id: 1, name: 'Jean Dupont',   role: 'admin',     email: 'j.dupont@nexapi.io' },
    { id: 2, name: 'Marie Lambert', role: 'developer', email: 'm.lambert@nexapi.io' },
    { id: 3, name: 'Alex Torres',   role: 'analyst',   email: 'a.torres@nexapi.io' },
];
router.get('/demo/v1/users', async (req, res) => {
    const suspicion   = getSuspicion(req, visitors);
    const sessionSeed = getSessionSeed(req, visitors);
    await delay(frictionMs(suspicion));
    // Règle 2 : toujours refract() — jamais data brut
    const data = refract(USERS_DATASET, USERS_POLICY, sessionSeed, currentEpoch());
    res.json({ data, meta: { total: data.length } });
});
// /demo/v1/keys supprimé — était une route 401 vide qui ajoutait de la surface sans valeur


// --- Admin dashboard data (token requis) ---
router.get('/admin/stats',      adminController.getStats);
router.get('/admin/visitors',   trackingController.getVisitors);
router.get('/admin/visitor/:id',trackingController.getVisitorById);
router.get('/admin/logs',       trackingController.getLogs);
router.post('/admin/telegram',  telegramController.sendReport);

module.exports = router;
