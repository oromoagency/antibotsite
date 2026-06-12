# Architecture Prisme Causal — Reference

## Decision Framework

```
Suspicion ∈ [0, 1]
                          ┌─────────────────────────────────┐
                          │     causalOrchestrator           │
                          │                                  │
  contradictions[] ──────►│  calculateSuspicion()            │
  coherence.level  ──────►│  decideReality()                 │
  humanValidated   ──────►│                                  │
                          └─────────────┬───────────────────┘
                                        │
               ┌────────────────────────┼──────────────────────┐
               ▼                        ▼                       ▼
           blocked                 gate_required           normal/watermarked
           (403)                 (gateway.html)            (refracted content)
```

## Suspicion Weights

| Contradiction severity | Suspicion added |
|---|---|
| `critical` | +0.50 |
| `high` | +0.25 |
| `medium` | +0.12 |
| `low` | +0.05 |
| (base) | 0.10 |

Capped at 1.0. Friction formula: `min(suspicion³ × 8000ms, 600ms)`

A human with suspicion 0.9 waits `min(0.729 × 8000, 600) = 600ms` — invisible.

## Reality States

| Reality | Trigger | Content |
|---|---|---|
| `normal` | humanValidated + no contradictions | Refracted (watermark only) |
| `watermarked` | humanValidated + medium contradictions | Watermark + poison |
| `observed` | Low suspicion, not yet validated | Gate required |
| `gate_required` | Unknown session | Redirect to gateway |
| `decoy` | High contradictions (non-zero-bot mode) | Honeypot injected |
| `blocked` | Critical/high contradictions in ZBM | 403 |

## Field Policy Reference

```js
const POLICY = {
  // Actionable — never touched
  price:     'actionable',  // Payment, pricing
  sku:       'actionable',  // Product identifiers
  stock:     'actionable',  // Availability
  dosage:    'actionable',  // Medical/legal

  // Cosmetic — watermarked per session
  name:        'cosmetic',  // Product names (synonyms applied)
  description: 'cosmetic',  // Marketing copy
  email:       'cosmetic',  // Contact info (traceable if leaked)
  endpoint:    'cosmetic',  // API paths in documentation

  // Aggregate — poisoned per item+epoch
  rank:        'aggregate', // Sort position
  popularity:  'aggregate', // View counts
  rating:      'aggregate', // Scores
  requests:    'aggregate', // Traffic metrics
};
```

## Contradiction Rules — Signal Map

```
Domain: identity
  └── ua_spoofing_search_crawler (critical)  — UA claims verified crawler
  └── script_http_client (critical)          — curl/wget/python UA

Domain: client headers
  └── ua_missing_accept_language (medium)    — browser UA, no Accept-Language
  └── client_hints_mismatch (medium)         — Chromium UA, no sec-ch-ua

Domain: network / infrastructure
  └── session_identity_drift (medium)        — UA changed mid-session
  └── ip_datacenter (medium)                 — browser UA from cloud IP

Domain: intent / api
  └── api_first_session (high)               — API before any page view
  └── honeypot_access (critical)             — invisible trap triggered

Domain: timing
  └── request_velocity_spike (medium–high)   — >120 requests total
  └── early_api_burst (high)                 — >10 API calls in first 60s
```

## Session Lifecycle

```
New request
  │
  ├─ nx_sess cookie present? ─── Yes ──► sessionStore.getSession()
  │                                              │
  │                                       Session exists?
  │                                         │         │
  │                                        Yes        No
  │                                         │         │
  │                                   req.visitor  createSession()
  │                                         │         │
  │                               ◄──────────┘         │
  │                                                     │
  └─ nx_sess absent ────────────────────────────────────┘
        │
        ▼
    createSession() → {
      id:             'nx_...',
      internalSeed:   crypto.randomBytes(32),  // Secret — never sent to client
      humanValidated: false,
      suspicion:      0.1,
      facts:          [],
      coherence:      { level: 'unknown', contradictions: [] },
      prisme:         { reality: 'normal' },
      counters:       { requests: 0, sensitiveApiCalls: 0 },
    }
        │
        ▼
    setSessionCookie(res, session.id)  // nx_sess → httpOnly, secure, SameSite: Lax
```

## Argon2id PoW Challenge Flow

```
Client                          Server
  │                               │
  │── GET /api/challenge-config ──►│
  │◄── { difficulty, serverNonce } ─│ (nonce stored in pendingNonces map)
  │                               │
  │  (mine Argon2id in WASM)      │
  │                               │
  │── POST /api/verify-challenge ──►│
  │   { nonce, argon2Hash, ... }   │ (validate nonce, verify hash, run L1–L6)
  │                               │
  │◄── { success: true, suspicion }─│ (req.visitor.humanValidated = true)
  │                               │
  │── GET / ──────────────────────►│ (requireHuman → now passes)
  │◄── landing.html (refracted) ───│
```

## Refraction — Implementation Detail

### Watermark channels (cosmetic fields)

1. **Synonym substitution** — 30+ base words with 3–4 semantic equivalents each.  
   Applied at word boundaries (`\b`), case-insensitive.  
   Selection: `variants[hashInt(sessionSeed + baseWord) % variants.length]`

2. **Number formatting** — integers ≥ 1000 formatted with varying thousand separators  
   (`1234`, `1,234`, `1 234`, `1.234`) based on session hash.

### Poison resistance (aggregate fields)

Formula: `value + (hashInt(itemId + ':' + fieldKey + epoch) % 7) - 3`

- Range: `[-3, +3]`
- Deterministic: same item + same epoch = same offset for ALL sessions
- Epoch: ISO week (`2025-W24`) — rotates weekly to invalidate built-up anchor knowledge
- Not per-session: the inter-session mean equals the poisoned value, not the true value

### Anchor attack resistance

If an attacker knows the true value of one item (external source), they can detect the direction of the bias for that item. This does not recover other items' true values (each item has an independent hash). It does reveal the epoch-based poison is active — but not the session watermark, which varies per session.

## Zero Bot Mode — Route Matrix

| Route | Condition | Response |
|---|---|---|
| `GET /api/challenge-config` | Always public | `{ difficulty, serverNonce }` |
| `POST /api/verify-challenge` | Always public | `{ success, suspicion }` |
| `GET /robots.txt` | Always public | `Disallow: /` |
| `GET /` | humanValidated required | `landing.html` (refracted) or → gateway |
| `GET /api/prism/demo` | humanValidated required | refracted DEMO_DATASET |
| `GET /api/admin/stats` | `x-admin-token` required | admin data |
| `/__internal/v2/stats` | Always (honeypot) | 403 + strike recorded |

## Deployment Notes

**Cloudflare in front:**
- Set `app.set('trust proxy', 1)`
- Extract real IP from `CF-Connecting-IP` (validated against CF CIDR list)
- JA4 fingerprint arrives via `X-JA4` header if Cloudflare Bot Management is enabled

**Render / Railway / Heroku:**
- Set `SECRET_KEY` and `ADMIN_TOKEN` as environment secrets
- `NODE_ENV=production` enables `secure: true` on cookies

**Akamai EdgeWorkers:**
- Use `prismeCore.analyzeRequest()` at the edge
- Pass `humanValidated` from your session store
- Return `edgeHeaders()` in the response
