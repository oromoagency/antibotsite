const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');

const { PrismeShield } = require('../prism-sdk');
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

// Rate-limit global : 60 req/min par IP.
// Couvre le dashboard admin (~10/min) + résolution PoW (~5 req) + navigation normale.
// Les rafales de bots (8+ req/s) déclenchent le 429 avant d'atteindre la gateway.
app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limit_exceeded', retryAfter: 60 },
}));

// X-Robots-Tag sur toutes les réponses : bloquer les crawlers de moteurs
// qui respectent les headers (Google, Bing, etc.) sans avoir besoin de robots.txt.
app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    next();
});

app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Déployer le bouclier Prisme sur toute l'application
app.use(PrismeShield({
    adminToken: config.ADMIN_TOKEN,
    secretKey: config.SECRET_KEY,
    challengeDifficulty: config.CHALLENGE_DIFFICULTY,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    zeroBotMode: true
}));

app.use('/api', apiRoutes);
app.use('/', webRoutes);

// N'écoute QUE si lancé directement (`node src/server.js`).
// Importé par les tests d'intégration, le module exporte `app` sans ouvrir de port.
if (require.main === module) {
    app.listen(config.PORT, () => {
        console.log(`[ANTIBOT] Serveur lancé sur le port ${config.PORT}`);
        console.log(`[ANTIBOT] Difficulté PoW: ${config.CHALLENGE_DIFFICULTY}`);
    });
}

module.exports = app;
