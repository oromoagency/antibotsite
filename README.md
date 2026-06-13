# Prisme Antibot

**Multi-layer bot detection engine for Node.js / Express.**  
Blocks automated traffic, watermarks suspicious sessions, and poisons scraped data — without ever interrupting a real human.

> **Core doctrine:** A single signal never decides. Every action requires corroboration from at least two independent detection domains.

---

## Table of Contents

1. [How It Works — The Big Picture](#how-it-works)
2. [Detection Architecture — 7 Layers](#detection-architecture)
3. [Causal Contradiction Engine — 14 Rules](#causal-contradiction-engine)
4. [Decision Flow — 6 Realities](#decision-flow)
5. [Data Protection — Watermark + Poison](#data-protection)
6. [Screenshot Bot Defenses](#screenshot-bot-defenses)
7. [Admin Dashboard](#admin-dashboard)
8. [Quick Start](#quick-start)
9. [Integration Guide](#integration-guide)
10. [Configuration Reference](#configuration-reference)
11. [Security Checklist](#security-checklist)
12. [Honest Limitations](#honest-limitations)

---

## How It Works

A visitor arrives. The system never asks "is this a bot?" It asks:

> **"Can the observed facts causally coexist on a real physical device?"**

Every layer observes its domain and emits **facts**. Facts feed a **causal contradiction engine** that checks whether the combination is physically plausible. Contradictions from two or more independent domains trigger escalation.

```
Visitor
  │
  ├─ L1 Network/TLS   → JA4 fingerprint, header anomalies, bot UA declarations
  ├─ L2 IP Reputation → Datacenter ASN, blacklists, velocity
  ├─ L3 PoW           → Argon2id challenge (2–4s CPU, anti-replay nonce)
  ├─ L4 Hardware      → GPU renderer, render time, screen coherence, DPR
  ├─ L5 Automation    → WebDriver, CDP traps, VSync analysis
  ├─ L6 Biometrics    → Mouse trajectory, keystroke timing, pressure
  └─ L7 Session       → Opaque token, per-session seed for data refraction
         │
         ▼
  Causal Contradiction Engine (14 rules)
         │
         ▼
  Reality: normal / watermarked / decoy / observed / gate_required / blocked
         │
         ▼
  refract(data, policy, sessionSeed, epoch)  →  client
```

Bots that pass the gate receive valid responses — but with watermarked identifiers and poisoned aggregate fields. Their scraped datasets are **traceable and mathematically corrupted**.

---

## Detection Architecture

### L1 — Network & TLS

Examines the request before any application logic runs.

| Signal | Penalty | Notes |
|---|---|---|
| Known bot User-Agent (`Googlebot`, `sqlmap`, `GPTBot`…) | −100 | Declarative — bot identifies itself |
| JA4 TLS fingerprint mismatch | variable | TLS hello differs from declared UA |
| HTTP/1.x header order anomaly | −15 | Host not first = proxy/library |
| UA casing anomaly (`user-agent` vs `User-Agent`) | −15 | Libraries vs real browsers |

### L2 — IP Reputation

| Signal | Penalty | Notes |
|---|---|---|
| IP in datacenter CIDR (AWS, GCP, Azure, DigitalOcean…) | −15 | Weak alone — WARP/iCloud Relay also match |
| IP in ASN blacklist (15 infrastructure-only ASNs) | −25 | Stronger — residential humans never appear here |
| IP flagged suspect (recent block in last 30 min) | −30 | Rolling window |
| Camoufox + CDP detected simultaneously | −20 | Extra penalty on L4 for compound signal |

### L3 — Proof of Work (Argon2id)

Every visitor solves a server-nonce–bound Argon2id challenge before receiving any session token. This makes mass bot operations economically unviable.

| Parameter | Value |
|---|---|
| Algorithm | Argon2id |
| Difficulty | 4–7 (adaptive based on fleet posture) |
| Memory | 4096 KB |
| Time cost | 2 iterations |
| Nonce TTL | 10 minutes (single-use, anti-replay) |

**Adaptive difficulty:** when the fleet posture escalates (`VIGILANCE` / `ATTACK`), the difficulty ratchets up (capped at 5 with a 90s grace period). Humans who stay on the page through an escalation get a new nonce automatically.

### L4 — Hardware Fingerprint

Checks that the declared hardware is physically coherent. This layer has the most signals.

**GPU Renderer**

| Signal | Penalty | Notes |
|---|---|---|
| SwiftShader / ANGLE-Software | −35 | Headless Chrome default — also matches blocklistd GPUs |
| llvmpipe / Mesa Offscreen / Microsoft Basic Render | −25 | VDI/RDP (capped — legitimate RDP users exist) |
| GPU family ↔ OS mismatch | −50 | Apple GPU on non-Apple UA; Adreno/Mali on non-Android UA |

**WebGL Render Time**

A 256×256 canvas with a 64-iteration trigonometric shader is rendered 5 times with `gl.finish()` forcing GPU sync. Real GPUs: <2ms/frame. SwiftShader: >50ms/frame.

| Signal | Penalty | Threshold |
|---|---|---|
| Render time > 25ms/draw | −30 | Catches software renderers that spoof the renderer string |

**Screen Profile**

| Signal | Penalty | Notes |
|---|---|---|
| `pointer: none` (no pointing device) | −40 | Headless Linux without X11 |
| Mobile UA + `pointer: fine` | −40 | Finger input impossible with mouse pointer |
| Mobile UA + `maxTouchPoints = 0` | −40 | Real mobile always ≥ 1 |
| Mobile UA + `devicePixelRatio ≤ 1.0` | −35 | Cheapest Android phone ≥ 1.5 DPR |

**Canvas / Audio / WebGPU**

| Signal | Penalty | Notes |
|---|---|---|
| WebGL absent | −15 | Absence only — Brave/Tor/RFP also block |
| Canvas blocked | −10 | Capped jointly (ABSENCE_CAP = −20) |
| AudioContext absent | −10 | Capped jointly |
| WebGPU absent on Chrome ≥113 with WebGL | −20 | Camoufox fingerprint |

**Other**

| Signal | Penalty | Notes |
|---|---|---|
| Sensor desync (event dt < 1ms) | −100 | JS input injection proof |
| Battery level > 1.0 | −30 | W3C spec violation — bot sending raw %, not 0.0–1.0 |
| UA absent in fingerprint | −20 | Malformed payload (client broken or raw POST) |

### L5 — Automation Detection

Detects the presence of browser control frameworks regardless of stealth level.

| Signal | Penalty | Notes |
|---|---|---|
| `navigator.webdriver === true` | −100 | Unpatched Selenium / Playwright |
| `$cdc_` / `$wdc_` artifacts | −80 | ChromeDriver remnants |
| `navigator.webdriver` accessor patched | −60 | Active stealth mode detected |
| Firefox `webdriver` HTML attribute | −40 | Geckodriver / Marionette |
| CDP Error.stack trap | −10 | DevTools Protocol active |
| VSync absent (<5 rAF frames) | −20 | No real compositor |
| VSync synthetic (variance < 0.001ms²) | −15 | Artificial clock |

**Threshold for `automation_anomaly` fact:** score ≤ −40. Signals like `vsyncAbsent` (−20) and `vsyncSynthetic` (−15) are excluded from the CRITICAL contradiction — they match Firefox RFP/privacy-mode false positives.

### L6 — Biometrics

Behavioral analysis of mouse and keyboard events collected during the PoW challenge.

| Signal | Penalty | Notes |
|---|---|---|
| No interaction (no mouse, touch, or keyboard) | −40 | Normal on fast PoW — not blockable alone |
| Teleport jump >300px in <50ms | −70 | VLM click-by-coordinates |
| Perfectly linear trajectory | −60 | Generated path |
| CDP synthetic inject (pressure=0 or geometry=0) | −50 | CDP mouse injection |
| Jerk = 0 (smooth trajectory) | −80 | Numerically generated |
| Flat keystroke cadence (identical dwell times) | −40 | Injected keystrokes |
| Superhuman typing (<8ms mean flight time) | −40 | Burst injection |
| Moves without any click | −5 | Intentionally weak — humans browse without clicking |
| Keyboard without pointer | −5 | Accessibility — very weak |

### L7 — Session Token

After successful PoW + pipeline clearance, an opaque JWT is issued and set as `HttpOnly, SameSite: Strict` cookie.

The token embeds a **`sessionSeed`** — a per-visitor entropy value used by `refract()` to generate deterministic, unique watermarks for cosmetic API fields. The seed never changes for a given visitor, making leaked datasets attributable to a specific session.

---

## Causal Contradiction Engine

14 rules evaluate causal plausibility across 8 independent signal groups. A contradiction is only actionable when two or more **different** groups fire.

| # | Rule ID | Severity | Independent Group |
|---|---|---|---|
| 1 | `api_first_session` | high | `api_intent` |
| 2 | `session_identity_drift` | medium | `network_consistency` |
| 3 | `request_velocity_spike` | medium / high | `velocity` |
| 4 | `ua_missing_accept_language` | medium | `header_consistency` |
| 5 | `client_hints_mismatch` | medium | `header_consistency` |
| 6 | `ua_spoofing_search_crawler` | **critical** | `identity` |
| 7 | `script_http_client` | **critical** | `identity` |
| 8 | `ip_datacenter` | medium | `network_infra` |
| 9 | `honeypot_access` | **critical** | `honeypot` |
| 10 | `early_api_burst` | high | `early_burst` |
| 11 | `automation_detected` | **critical** | `automation_flag` |
| 12 | `hardware_anomaly` | high | `hardware_consistency` |
| 13 | `biometric_anomaly` | high | `human_interaction` |
| 14 | `sensor_desync_detected` | **critical** | `sensor_sync` |

**Corroboration doctrine:**
- **1 CRITICAL** → blocked immediately (Zero Bot Mode) or decoy
- **≥2 HIGH from different groups** → blocked (Zero Bot Mode) or decoy
- **1 HIGH from 1 group** → watermarked (token granted, data poisoned)
- **MEDIUM only** → watermarked
- **0 contradictions, humanValidated** → normal

---

## Decision Flow

```
decideReality(session) → one of 6 realities:

blocked       → 403. Session earns a reputation strike.
                Conditions: CRITICAL contradiction OR ≥2 independent HIGH groups (Zero Bot Mode)

decoy         → 200 OK. Session receives deliberately wrong data.
                Conditions: same as blocked but Zero Bot Mode disabled

watermarked   → 200 OK. Real data + watermark + honeypot fields injected.
                Conditions: 1 HIGH group OR any MEDIUM contradiction

observed      → 200 OK. Real data + watermark. No honeypot injection.
                Conditions: same as watermarked but Zero Bot Mode disabled

gate_required → Redirect to gateway.html (Argon2id PoW)
                Conditions: no CRITICAL/HIGH, but session not yet humanValidated

normal        → Full access. Light refraction only.
                Conditions: humanValidated = true, coherence clean
```

The `suspicion` value (0.0 – 1.0) is available at `req.visitor.suspicion` for fine-grained routing in your application.

---

## Data Protection

### Refraction Engine

Every API response passes through `refract(data, policy, sessionSeed, epoch)`.

```js
const { refract, currentEpoch } = require('./prism-sdk/src/server/refractor');

const PRODUCT_POLICY = {
  id:          'actionable',  // Exact — humans and bots see the same value
  price:       'actionable',  // Exact — never tampered
  name:        'cosmetic',    // Per-session watermark (synonym substitution)
  description: 'cosmetic',   // Per-session watermark
  rank:        'aggregate',   // Per-item+epoch poison (inter-session average = poisoned)
  views:       'aggregate',   // Per-item+epoch poison
};

app.get('/api/products', requireHuman, (req, res) => {
  const data = refract(products, PRODUCT_POLICY, req.visitor.internalSeed, currentEpoch());
  res.json(data);
});
```

### Three Field Policies

| Policy | Mechanism | Human impact | Bot impact |
|---|---|---|---|
| `actionable` | Exact — never modified | Zero | Zero (this field is safe to expose) |
| `cosmetic` | Synonym watermark per session | Reads "robust" instead of "sturdy" | Leaks are attributed to the source session |
| `aggregate` | Structural offset per item+epoch | Zero | Average of 1000 sessions = poisoned value |

### Why Aggregate Poison Resists Averaging

Random per-session noise cancels out when averaged:
```
Session A: rank=4, Session B: rank=2, Session C: rank=3 → average ≈ 3 (true)
```

Epoch-bound poison is the **same for all sessions** in a given time window:
```
Session A: rank=5, Session B: rank=5, Session C: rank=5 → average = 5 (poisoned)
```

A scraper's training dataset is systematically wrong — not randomly noisy.

### Honeypot Injection

Suspicious sessions (`decoy` or `watermarked`) receive extra fields in API responses:

```json
{
  "id": "svc-1",
  "name": "Core API",
  "__ghost_rank": 7,
  "__trap_api": "/__internal/v2/stats"
}
```

A bot that follows `__trap_api` triggers the honeypot, earns a reputation strike, and its session escalates to `blocked`.

---

## Screenshot Bot Defenses

Screenshot bots visit the site like humans, render the full page, take a screenshot, and send it to hosting providers to report the site. They do not scrape — they just need a visual.

### 1. Gateway Anonymization

`gateway.html` contains no branding, no service name, no identifying information. A screenshot reveals only a spinner on a dark background.

### 2. Landing Page Lazy Reveal

An opaque overlay (`#0a0f1e`, `z-index: 999999`) covers the entire landing page at load. It is removed only when the first real human input event arrives:

```
mousemove | touchstart | scroll | keydown  →  overlay fades out (0.4s)
3 seconds with no interaction              →  overlay auto-removes (real users who don't move)
```

Screenshot bots that capture immediately see a black screen. The 3-second fallback ensures immobile real users are not stuck.

### 3. Physical Screen Detection (L4 Screen Profile)

Collected via `getScreenProfile()` in the gateway challenge. Detects devices without a real physical display:

```js
// Client-side (gateway.html)
function getScreenProfile() {
  return {
    rafMean:       /* mean rAF interval in ms */,
    rafSamples:    /* number of valid rAF frames */,
    pointerFine:   matchMedia('(pointer: fine)').matches,
    pointerCoarse: matchMedia('(pointer: coarse)').matches,
    pointerNone:   matchMedia('(pointer: none)').matches,
    hoverHover:    matchMedia('(hover: hover)').matches,
    colorGamutP3:  matchMedia('(color-gamut: p3)').matches,
    maxTouchPoints: navigator.maxTouchPoints,
    pixelRatio:    devicePixelRatio,
  };
}
```

---

## Admin Dashboard

Available at `/admin` (requires `x-admin-token` header or login).

**Overview tab:** live fleet stats (posture, allow/block rates, suspicion distribution, honeypot activity).

**Visitors tab:** per-session detail — IP, score, layer breakdown, contradiction list, reality label.

**Logs tab:** rolling event log with layer-prefixed reasons.

**Download report:** full JSON snapshot via `GET /api/admin/report` — includes posture, visitors, events, honeypot stats, causal contradictions.

**Telegram alerts:** real-time notifications on bot blocks and suspicious activity.

---

## Quick Start

```bash
git clone <this repo>
cd antibotsite
npm install
cp .env.example .env
# Edit .env: set SECRET_KEY and ADMIN_TOKEN
npm start
# → http://localhost:3000
```

**Development (auto-restart):**
```bash
npm run dev
```

**Tests:**
```bash
npm test
```

---

## Integration Guide

### Adding Prisme to an existing Express app

**Step 1 — Install dependencies**

```bash
npm install argon2 cookie-parser helmet express-rate-limit
```

**Step 2 — Copy the antibot directory**

```
your-project/
  src/
    antibot/          ← copy this entire directory
    layers/           ← copy this entire directory
    config/tuning.js  ← copy and adjust thresholds
    policy/           ← copy verdict.js and posture.js
    store/            ← copy visitors.js, reputation.js, events.js, nonces.js
  prism-sdk/          ← copy this entire directory
  public/
    argon2.min.js     ← required client-side
    argon2.wasm       ← required client-side
```

**Step 3 — Register middleware**

```js
const express      = require('express');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const antibotEntry = require('./antibot/middleware/antibotEntry');
const L1_network   = require('./layers/L1_network');

const app = express();

app.use(helmet());
app.use(cookieParser());
app.use(express.json());

// Global rate limit
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// L1 — network signals collected before routes
app.use(L1_network.middleware);

// Prisme session + causal pipeline
app.use(antibotEntry);
```

**Step 4 — Add the gateway routes**

```js
const validationController = require('./controllers/validationController');
const L7_session           = require('./layers/L7_session');

// PoW challenge endpoints (public — no gate)
router.get('/api/challenge-config',  validationController.getChallengeConfig);
router.post('/api/verify-challenge', validationController.verifyChallenge);
router.post('/api/feedback-invisible', validationController.recordSilentFeedback);

// Human gate middleware
const requireHuman = (req, res, next) => {
  const jwt = L7_session.verifyToken(req.cookies['human_auth_token']);
  if (jwt.valid) return next();
  if (req.visitor?.humanValidated) return next();
  return res.status(401).json({ error: 'human_session_required' });
};
```

**Step 5 — Serve the gateway page**

```js
// Web routes — gate all protected pages
app.get('/', requireHuman, (req, res) => res.sendFile('landing.html'));
app.get('/gateway', (req, res) => res.sendFile('gateway.html'));
```

**Step 6 — Wrap all API responses**

```js
const { refract, currentEpoch } = require('./prism-sdk/src/server/refractor');
const { getSessionSeed }        = require('./middlewares/prismAdapter');

// Define your policy
const MY_POLICY = {
  id:          'actionable',
  price:       'actionable',
  name:        'cosmetic',
  description: 'cosmetic',
  rank:        'aggregate',
};

app.get('/api/products', requireHuman, (req, res) => {
  const seed = getSessionSeed(req);
  const data = refract(rawProducts, MY_POLICY, seed, currentEpoch());
  res.json(data);
});
```

**Step 7 — Add the gateway HTML**

Copy `src/views/gateway.html` and `public/argon2.min.js` / `argon2.wasm` to your project. The gateway requires no framework — it is a self-contained HTML file with an inline IIFE.

**Step 8 — Add the lazy reveal overlay to your landing page**

Paste this immediately after your `<body>` tag:

```html
<script>!function(){var g=document.createElement('div');g.id='__sgrd';g.style.cssText='position:fixed;inset:0;background:#0a0f1e;z-index:999999;pointer-events:none;transition:opacity 0.4s ease;';document.body.appendChild(g);var done=false;function reveal(){if(done)return;done=true;g.style.opacity='0';setTimeout(function(){if(g.parentNode)g.parentNode.removeChild(g);},400);['mousemove','touchstart','scroll','keydown'].forEach(function(e){document.removeEventListener(e,reveal,true);});}['mousemove','touchstart','scroll','keydown'].forEach(function(e){document.addEventListener(e,reveal,{once:true,passive:true,capture:true});});setTimeout(reveal,3000);}();</script>
```

Change `background:#0a0f1e` to match your site's background color.

### Edge / Serverless (Cloudflare Workers)

```js
// edge/worker.js
const { analyzeRequest } = require('./src/antibot/core/prismeCore');

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const decision = analyzeRequest({
    path:         new URL(request.url).pathname,
    method:       request.method,
    userAgent:    request.headers.get('user-agent'),
    cookieHeader: request.headers.get('cookie'),
    humanValidated: false,
  });

  if (decision.action === 'deny') {
    return new Response('Access restricted', { status: 403 });
  }
  if (decision.action === 'gate') {
    return Response.redirect('/gateway');
  }

  // Forward to origin, add Prisme headers
  const response = await fetch(request);
  return response;
}
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | Yes | random (sessions reset on restart) | JWT signing key |
| `ADMIN_TOKEN` | Yes | random (printed at startup) | Admin dashboard bearer token |
| `ANTIBOT_ZERO_BOT_MODE` | No | `true` | `false` → watermark only, never block |
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `development` | `production` enables `Secure` cookies |
| `TELEGRAM_BOT_TOKEN` | No | — | Telegram alert bot token |
| `TELEGRAM_CHAT_ID` | No | — | Telegram chat/channel ID for alerts |
| `CF_CONNECTING_IP` | No | — | Header name for Cloudflare real IP |

### Tuning (`src/config/tuning.js`)

All numeric thresholds are centralized here. No heuristic values appear in layer files.

**Key values:**

```js
verdict: {
  trustThreshold:    60,   // score ≥ 60 → human session issued
  strikeThreshold:   20,   // score < 20 → ban eligible
  significantSignal: -15,  // minimum contribution to count as a witness
},

L3: {
  minDifficulty: 4,         // PoW floor
  maxDifficulty: 5,         // PoW ceiling (adaptive)
},

L4: {
  headlessRenderer:  -35,   // SwiftShader
  vdiRenderer:       -25,   // llvmpipe / Basic Render (capped with absences)
  gpuOsMismatch:     -50,   // Apple GPU on Windows UA, Adreno on macOS UA, etc.
  webglRenderSlow:   -30,   // > 25ms/draw → software renderer
  screenPointerNone: -40,   // pointer:none
  screenMobileMismatch: -40,// mobile UA + desktop pointer or no touch
  mobileUaDprLow:    -35,   // mobile UA + DPR ≤ 1.0
  sensorDesync:     -100,   // JS input injection
  batterySpoof:      -30,   // level > 1.0
},

L5: {
  webdriverNative:  -100,   // navigator.webdriver = true
  firefoxDriver:     -40,   // geckodriver attribute
  vsyncAbsent:       -20,   // < 5 rAF frames
  vsyncSynthetic:    -15,   // variance < 0.001
},

L6: {
  noInteraction:     -40,   // no mouse/touch/keyboard
  teleport:          -70,   // >300px jump in <50ms
  syntheticInject:   -50,   // CDP pressure=0 injection
}
```

---

## Security Checklist

- [x] `robots.txt` → `Disallow: /` (all crawlers)
- [x] `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on all responses
- [x] Human session gate on all content and API routes
- [x] Sensitive APIs require `humanValidated: true`
- [x] Admin routes require `x-admin-token` header
- [x] `human_auth_token` cookie: `httpOnly`, `secure` (production), `SameSite: Strict`
- [x] `SECRET_KEY` from environment only — never hardcoded
- [x] All API responses pass through `refract()` — no raw data ever served
- [x] Server nonce per PoW challenge (single-use, 10-min TTL) — prevents replay
- [x] Honeypot trap on `/__internal/v2/stats`
- [x] CSRF check on `/api/feedback-invisible` (same-origin only)
- [x] Cloudflare IP extraction (`CF-Connecting-IP` validation)
- [x] Global rate limit: 500 req / 15 min per IP
- [x] Argon2id PoW — mass bot operation economically unviable at difficulty 4+
- [x] Gateway anonymized — no branding visible in screenshot
- [x] Landing page lazy reveal — screenshot bots see only a dark screen
- [x] Session seed embedded in JWT — data leaks attributable to source session

---

## Honest Limitations

**A bot running on a real physical device passes everything.**  
A real MacBook running Puppeteer has a real Apple GPU, real DPR, real rAF cadence. The system has no way to distinguish it from a human. However, renting 1000 MacBooks to scrape a site costs thousands of dollars per day — which is precisely the point. Prisme makes the attack unprofitable, not impossible.

**Watermark attribution requires a truth anchor.**  
If a scraper has one item with a known correct value from another source, they can compute the bias and de-poison aggregate fields for that item. The watermark still traces the source session, and the overall training dataset quality is still degraded.

**Zero Bot Mode is not zero bots.**  
Sufficiently motivated attackers with real hardware and time will eventually pass. The economic deterrent is the defense — not the gate itself.

**The only higher bar:** authentication + payment/identity verification + per-account rate limiting + legal terms. That adds friction for legitimate users too — it is a product decision, not a technical one.

---

## License

MIT
