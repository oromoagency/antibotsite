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

app.set('trust proxy', true);

// Middleware Cloudflare : utiliser CF-Connecting-IP comme IP source de vérité
app.use((req, res, next) => {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) {
        Object.defineProperty(req, 'ip', { get: () => cfIp });
    }
    next();
});

app.get('/api/test-ip', (req, res) => {
    res.json({
        ip: req.ip,
        cfIp: req.headers['cf-connecting-ip'],
        forwarded: req.headers['x-forwarded-for'],
        remote: req.connection.remoteAddress
    });
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
    max: 2000, // Augmenté pour supporter le polling du dashboard admin
    message: "Too many requests.",
}));

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Pipeline antibot : couche par couche
app.use(L1_network.analyze);    // L1 — protocole
app.use(L2_access.middleware);  // L2 — barrière IP bannies (temporaire)

app.use('/api', apiRoutes);
app.use('/', webRoutes);

app.listen(config.PORT, () => {
    console.log(`[ANTIBOT] Serveur lancé sur le port ${config.PORT}`);
    console.log(`[ANTIBOT] Difficulté PoW: ${config.CHALLENGE_DIFFICULTY}`);
});
