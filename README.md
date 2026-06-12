# NexAPI Antibot — Prisme Causal

**Bot protection without blocking humans.**

> Doctrine: I never return `data`. I return `refract(data, seed)`.  
> I never block anyone. I make mass extraction unprofitable.

## What This Is

NexAPI Antibot is a **causal coherence engine** for Node.js / Express.  
It does not try to classify bots. It makes their data useless while leaving the human experience intact.

Two modes:

| Mode | Behavior |
|---|---|
| **Prisme** | Serve all visitors. Watermark + poison data for suspected automation. |
| **Zero Bot Mode** | Human-only. No session validation = no useful content. |

---

## Core Concepts

### 1. No Doors, Only Lanes

There is no blocking node in the pipeline. A suspicion score **routes** visitors between lanes:

```
Rich lane       → SPA, full render, light watermark
Accessible lane → Semantic HTML, no JS required, full watermark + poison
```

Both lanes serve real, usable content. `actionable` fields are always exact. A human classified as suspicious at worst gets 600ms of invisible friction — never a refusal.

### 2. The Prisme Refraction Engine

Every API response passes through `refract(data, policy, sessionSeed, epoch)`.

```js
const POLICY = {
  price:       'actionable',   // Always exact — never touched
  description: 'cosmetic',     // Watermarked per session (traceable)
  rank:        'aggregate',    // Poisoned per item+epoch (resists averaging)
};

// You never return rawData. You return:
const safe = refract(rawData, POLICY, req.visitor.internalSeed, currentEpoch());
res.json(safe);
```

**Three field policies:**

| Policy | Mechanism | Human impact |
|---|---|---|
| `actionable` | Exact everywhere | Zero |
| `cosmetic` | Synonym watermark per session | Reads "sturdy" instead of "robust" — same meaning |
| `aggregate` | Structural poison per item | Rank is 4 instead of 3 — plausible, cripples ML training |

### 3. Watermark vs Poison — Two Opposite Axes

**Watermark** (traceability) — **per session**: each session gets a unique fingerprint in cosmetic fields. If a dataset leaks, you trace it to the source session.

**Poison** (aggregate corruption) — **per item + epoch**: the SAME offset is seen by ALL sessions. The inter-session average does NOT cancel the bias (unlike random per-session noise). This defeats the standard aggregation attack.

```
Wrong:  poison(rank, sessionSeed)       → average of 100 sessions ≈ true value
Right:  poison(rank, itemKey + epoch)   → every session sees same offset → average = poisoned value
```

### 4. Causal Contradiction Engine

The system evaluates **causal coherence**, not behavioral biometrics.  
It does not ask "does the mouse move naturally?" — it asks "can this action sequence be causally explained?"

**10 contradiction rules across 3 independent signal domains:**

| Rule | Domain | Severity |
|---|---|---|
| `api_first_session` | intent | high |
| `session_identity_drift` | network | medium |
| `request_velocity_spike` | timing | medium–high |
| `ua_missing_accept_language` | client headers | medium |
| `client_hints_mismatch` | client headers | medium |
| `ua_spoofing_search_crawler` | identity | critical |
| `script_http_client` | client | critical |
| `ip_datacenter` | infrastructure | medium |
| `honeypot_access` | automation | critical |
| `early_api_burst` | timing | high |

**Corroboration rule (non-negotiable):** a single contradiction never decides. Two independent domains are required to escalate to `blocked`.

### 5. Zero Bot Mode

In Zero Bot Mode, the gate is the entry point to all useful content:

```
No validated human session  →  gateway.html (Argon2id PoW challenge)
Validated human session     →  actual content (refracted)
Bot UA detected             →  403 (no detail revealed to client)
```

`robots.txt`:
```
User-agent: *
Disallow: /
```

---

## Architecture

```
Request
  │
  ▼
antibotEntry          nx_sess cookie → sessionStore → req.visitor
  │
  ▼
collectRequestFacts   IP, UA, headers, sec-ch-ua, Accept-Language → session.facts[]
  │
  ▼
contradictionEngine   10 causal rules → session.coherence.contradictions[]
  │
  ▼
attachDecision        causalOrchestrator → reality + suspicion → req.visitor
  │
  ├── blocked        →  403 "Access restricted"
  ├── gate_required  →  gateway.html (PoW Argon2id)
  └── normal / watermarked / decoy  →  route handlers
                                            │
                                            ▼
                                      refract(data, policy, seed, epoch)
                                            │
                                      ├── Rich lane (SPA)
                                      └── Accessible lane (semantic HTML, no JS)
```

---

## Quick Start

```bash
npm install
cp .env.example .env   # set SECRET_KEY and ADMIN_TOKEN
npm start
```

Environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | Yes | random (sessions reset on restart) | Session signing key |
| `ADMIN_TOKEN` | Yes | random (printed at startup) | Admin dashboard access |
| `ANTIBOT_ZERO_BOT_MODE` | No | `true` | Enable Zero Bot Mode |
| `PORT` | No | `3000` | HTTP port |
| `NODE_ENV` | No | `development` | `production` enables secure cookies |

---

## Integration

### Express (any Node.js project)

```js
const antibotEntry        = require('./antibot/middleware/antibotEntry');
const collectRequestFacts = require('./antibot/middleware/collectRequestFacts');
const contradictionEngine = require('./antibot/middleware/contradictionEngine');
const attachDecision      = require('./antibot/middleware/attachDecision');
const { refract, currentEpoch } = require('./prism-sdk/src/server/refractor');

app.use(antibotEntry);
app.use(collectRequestFacts);
app.use(contradictionEngine);
app.use(attachDecision);

// In your route handlers:
app.get('/api/products', requireHumanApi, (req, res) => {
  const data = refract(products, PRODUCT_POLICY, req.visitor.internalSeed, currentEpoch());
  res.json(data);
});
```

### Edge-compatible core (Cloudflare Workers / Akamai EdgeWorkers)

`prismeCore.js` is platform-neutral — no Node.js APIs:

```js
const { analyzeRequest, edgeHeaders } = require('./src/antibot/core/prismeCore');

// In your edge handler:
const decision = analyzeRequest({
  path:           request.url,
  method:         request.method,
  userAgent:      request.headers.get('user-agent'),
  cookieHeader:   request.headers.get('cookie'),
  humanValidated: false,
});

if (decision.action === 'deny')  return new Response('Access restricted', { status: 403 });
if (decision.action === 'gate')  return Response.redirect('/gateway');
// else serve refracted content
```

---

## Tests

```bash
npm test             # all tests
npm run test:unit    # unit tests only
```

**29 tests — 0 failures.**

Covers:
- `actionable` field invariant (exact in all lanes)
- Watermark determinism (same session = same watermark)
- Poison inter-session resistance (average equals poisoned value, not true value)
- All 10 contradiction rules (positive and negative cases)
- Orchestrator: `unknown` → `gate_required`, bot → `blocked`, human → `normal`

---

## Honest Limitations

**Zero bots is impossible on a public site.** A real browser + multimodal AI sees exactly what a human sees. The goal is not zero bots — it is making mass extraction **unprofitable** relative to competing targets.

**Partial poison.** A truth anchor (one item with a known value from another source) reveals the bias direction. This defeats ML training and mass competitive intelligence. It does not stop a targeted, well-resourced adversary.

**The only higher bar:** make the site non-public (authentication + payment/identity verification + per-account rate limiting + legal terms). That raises the bar substantially — but it also changes the product.

---

## Security Checklist

- [x] `robots.txt` disallows all crawlers
- [x] `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on all responses
- [x] Human session gate active on all content routes
- [x] Sensitive APIs require `humanValidated: true`
- [x] Admin routes require `x-admin-token` header (bypasses human gate)
- [x] `nx_sess` cookie: `httpOnly`, `secure` (production only), `SameSite: Lax`
- [x] `SECRET_KEY` from environment only — never hardcoded
- [x] All API responses go through `refract()` — no raw data ever served
- [x] Honeypot trap on `/__internal/v2/stats`
- [x] Cloudflare IP validation (CF-Connecting-IP spoofing prevention)
- [x] Argon2id PoW with server nonce (anti-replay protection)
- [x] Global rate limit: 500 req / 15 min per IP

---

## License

MIT
