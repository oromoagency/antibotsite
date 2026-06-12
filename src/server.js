const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');

const L1_network = require('./layers/L1_network');
const L2_access  = require('./layers/L2_access');

const apiRoutes = require('./routes/api');
const webRoutes = require('./routes/web');

const app = express();

// Render est derrière un seul proxy (Cloudflare/load-balancer) — trust 1 seul hop.
// `true` ferait confiance à n'importe quel X-Forwarded-For, ce qui permettrait
// à un attaquant de forger son IP.
app.set('trust proxy', 1);

// Plages IPv4 Cloudflare publiées sur https://www.cloudflare.com/ips-v4
// Utilisées pour valider que CF-Connecting-IP vient réellement de Cloudflare.
const CF_CIDRS = [
    ['103.21.244.0', 22], ['103.22.200.0', 22], ['103.31.4.0', 22],
    ['104.16.0.0', 13],   ['104.24.0.0', 14],   ['108.162.192.0', 18],
    ['131.0.72.0', 22],   ['141.101.64.0', 18],  ['162.158.0.0', 15],
    ['172.64.0.0', 13],   ['173.245.48.0', 20],  ['188.114.96.0', 20],
    ['190.93.240.0', 20], ['197.234.240.0', 22], ['198.41.128.0', 17],
];
const ipToInt = (ip) => {
    const parts = String(ip).replace(/^::ffff:/, '').split('.');
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        const o = parseInt(p, 10);
        if (isNaN(o) || o < 0 || o > 255) return null;
        n = n * 256 + o;
    }
    return n;
};
const isCloudflareIp = (ip) => {
    const n = ipToInt(ip);
    if (n === null) return false;
    return CF_CIDRS.some(([base, bits]) => {
        const b = ipToInt(base);
        if (b === null) return false;
        const size = Math.pow(2, 32 - bits);
        return Math.floor(n / size) === Math.floor(b / size);
    });
};

// Middleware Cloudflare : n'accepte CF-Connecting-IP que si la requête vient
// d'une IP Cloudflare — sinon un attaquant pourrait forger l'en-tête pour
// bypasser les bans IP.
app.use((req, res, next) => {
    const cfIp = req.headers['cf-connecting-ip'];
    // Express avec 'trust proxy: 1' place l'IP vue par Render (Cloudflare) dans req.ip.
    // On valide donc req.ip, et non remoteIp (qui est l'IP interne du load balancer Render).
    if (cfIp && isCloudflareIp(req.ip)) {
        Object.defineProperty(req, 'ip', { get: () => cfIp, configurable: true });
    }
    next();
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "https://api.telegram.org", "https://ip-api.com"],
            workerSrc: ["'self'", "blob:"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500, // ~33 req/min par IP — couvre le dashboard admin (12/min) + usage normal
    message: "Too many requests.",
}));

app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Pipeline antibot : couche par couche
// DÉSACTIVÉ TEMPORAIREMENT
// app.use(L1_network.analyze);    // L1 — protocole
// Protection antibot activée sur TOUTES les routes.
// TEMPORAIREMENT DÉSACTIVÉE : Pour permettre le développement de l'Admin et de Prisma.
// app.use(antibotMiddleware);  // L2 — barrière IP bannies (temporaire)

app.use('/api', apiRoutes);
app.use('/', webRoutes);

app.listen(config.PORT, () => {
    console.log(`[ANTIBOT] Serveur lancé sur le port ${config.PORT}`);
    console.log(`[ANTIBOT] Difficulté PoW: ${config.CHALLENGE_DIFFICULTY}`);
});
