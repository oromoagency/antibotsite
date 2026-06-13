# Prisme Antibot

**Moteur de détection de bots multi-couches pour Node.js / Express.**  
Bloque le trafic automatisé, filigranne les sessions suspectes et empoisonne les données scrapées — sans jamais interrompre un vrai humain.

> **Doctrine fondamentale : un seul signal ne décide jamais. Chaque blocage exige la corroboration d'au moins deux domaines de détection indépendants.**

---

## Sommaire

1. [Comment ça marche](#comment-ça-marche)
2. [Architecture de détection — 7 couches](#architecture-de-détection)
3. [Moteur de contradictions causales — 14 règles](#moteur-de-contradictions-causales)
4. [Flux de décision — 6 réalités](#flux-de-décision)
5. [Protection des données — Filigrane + Poison](#protection-des-données)
6. [Défenses contre les bots screenshot](#défenses-contre-les-bots-screenshot)
7. [Dashboard Admin](#dashboard-admin)
8. [Démarrage rapide](#démarrage-rapide)
9. [Guide d'intégration](#guide-dintégration)
10. [Référence de configuration](#référence-de-configuration)
11. [Checklist sécurité](#checklist-sécurité)
12. [Limites honnêtes](#limites-honnêtes)

---

## Comment ça marche

Un visiteur arrive. Le système ne se pose pas la question "est-ce un bot ?". Il se pose la question :

> **"Les faits observés peuvent-ils coexister causalement sur un vrai appareil physique ?"**

Chaque couche observe son domaine et émet des **faits**. Ces faits alimentent un **moteur de contradictions causales** qui vérifie si la combinaison est physiquement plausible. Des contradictions venant de deux domaines indépendants ou plus déclenchent une escalade.

```
Visiteur
  │
  ├─ L1 Réseau/TLS     → Empreinte JA4, anomalies d'en-têtes, UA bots déclaratifs
  ├─ L2 Réputation IP  → ASN datacenter, listes noires, vélocité
  ├─ L3 Preuve de travail → Défi Argon2id (2–4s CPU, nonce anti-rejeu)
  ├─ L4 Hardware       → GPU, temps de rendu, cohérence écran, DPR
  ├─ L5 Automatisation → WebDriver, pièges CDP, analyse VSync
  ├─ L6 Biométrie      → Trajectoire souris, timing clavier, pression
  └─ L7 Session        → Token opaque, seed par session pour la réfraction des données
         │
         ▼
  Moteur de contradictions causales (14 règles)
         │
         ▼
  Réalité : normal / watermarked / decoy / observed / gate_required / blocked
         │
         ▼
  refract(data, policy, sessionSeed, epoch)  →  client
```

Les bots qui passent la porte reçoivent des réponses valides — mais avec des identifiants filigranés et des champs agrégés empoisonnés. Leurs datasets scrapés sont **traçables et mathématiquement corrompus**.

---

## Architecture de détection

### L1 — Réseau & TLS

Analyse la requête avant toute logique applicative. S'exécute sur **toutes les routes** en lecture seule — ne bloque jamais seul, dépose `req.l1Signals` pour l'orchestrateur.

| Signal | Pénalité | Notes |
|---|---|---|
| User-Agent bot connu (`Googlebot`, `sqlmap`, `GPTBot`…) | −100 | Déclaratif — le bot s'identifie lui-même |
| Empreinte TLS JA4 ne correspond pas à l'UA déclaré | variable | Hello TLS différent du navigateur déclaré |
| Ordre des en-têtes HTTP/1.x anormal | −15 | Host pas en tête = proxy/bibliothèque |
| Casse User-Agent non standard (`user-agent` vs `User-Agent`) | −15 | Librairies HTTP vs vrais navigateurs |

### L2 — Réputation IP

| Signal | Pénalité | Notes |
|---|---|---|
| IP dans CIDR datacenter (AWS, GCP, Azure, DigitalOcean…) | −15 | Seul, très faible — WARP/iCloud Relay aussi |
| IP dans liste noire ASN (15 ASNs infrastructure exclusifs) | −25 | Plus fort — aucun humain résidentiel ici |
| IP signalée suspecte (blocage récent dans les 30 min) | −30 | Fenêtre glissante |
| Camoufox + CDP détectés simultanément | −20 | Pénalité extra sur L4 pour signal combiné |

### L3 — Preuve de travail (Argon2id)

Tout visiteur résout un défi Argon2id lié à un nonce serveur avant de recevoir un token de session. Cela rend les opérations de bots en masse économiquement non rentables.

| Paramètre | Valeur |
|---|---|
| Algorithme | Argon2id |
| Difficulté | 4–7 (adaptative selon la posture de flotte) |
| Mémoire | 4 096 Ko |
| Coût en temps | 2 itérations |
| TTL nonce | 10 minutes (usage unique, anti-rejeu) |

**Difficulté adaptative :** quand la posture de flotte monte (`VIGILANCE` / `ATTAQUE`), la difficulté augmente (plafonnée à 5 avec une grâce de 90s). Les humains qui restent sur la page pendant une escalade reçoivent automatiquement un nouveau nonce.

### L4 — Empreinte matérielle

Vérifie que le hardware déclaré est physiquement cohérent. C'est la couche la plus riche en signaux.

**Renderer GPU**

| Signal | Pénalité | Notes |
|---|---|---|
| SwiftShader / ANGLE-Software | −35 | Chrome headless par défaut — correspond aussi aux GPU blacklistés |
| llvmpipe / Mesa Offscreen / Microsoft Basic Render | −25 | VDI/RDP (plafonné — humains en RDP légitimes existent) |
| Famille GPU ↔ OS incohérents | −50 | GPU Apple sur UA non-Apple ; Adreno/Mali sur UA non-Android |

**Temps de rendu WebGL**

Un canvas 256×256 avec un shader trigonométrique (64 sin×cos par pixel) est rendu 5 fois avec `gl.finish()` forçant la synchronisation GPU. Vrai GPU : <2ms/frame. SwiftShader : >50ms/frame.

| Signal | Pénalité | Seuil |
|---|---|---|
| Temps de rendu > 25ms/draw | −30 | Détecte les renderers logiciels qui spoofent leur string renderer |

**Profil d'écran**

| Signal | Pénalité | Notes |
|---|---|---|
| `pointer: none` (aucun dispositif de pointage) | −40 | Linux headless sans X11 |
| UA mobile + `pointer: fine` | −40 | Doigt impossible avec pointeur souris — UA spoofé |
| UA mobile + `maxTouchPoints = 0` | −40 | Vrai mobile toujours ≥ 1 point tactile |
| UA mobile + `devicePixelRatio ≤ 1.0` | −35 | Android le moins cher ≥ 1.5 DPR |

**Canvas / Audio / WebGPU**

| Signal | Pénalité | Notes |
|---|---|---|
| WebGL absent | −15 | Absence seulement — Brave/Tor/RFP bloquent aussi |
| Canvas bloqué | −10 | Plafonné ensemble (ABSENCE_CAP = −20) |
| AudioContext absent | −10 | Plafonné ensemble |
| WebGPU absent sur Chrome ≥113 avec WebGL actif | −20 | Empreinte Camoufox |

**Autres**

| Signal | Pénalité | Notes |
|---|---|---|
| Désynchronisation capteurs (dt événement < 1ms) | −100 | Preuve d'injection JS d'entrées |
| Niveau batterie > 1.0 | −30 | Violation spec W3C — bot envoyant en %, pas en 0.0–1.0 |
| UA absent du fingerprint | −20 | Payload malformé (client cassé ou POST brut) |

### L5 — Détection d'automatisation

Détecte la présence de frameworks de pilotage de navigateur, indépendamment du niveau de furtivité.

| Signal | Pénalité | Notes |
|---|---|---|
| `navigator.webdriver === true` | −100 | Selenium/Playwright non patché |
| Artefacts `$cdc_` / `$wdc_` | −80 | Restes ChromeDriver |
| Accesseur `navigator.webdriver` patché | −60 | Mode furtif actif détecté |
| Attribut `webdriver` sur `<html>` Firefox | −40 | Geckodriver / Marionette |
| Piège CDP Error.stack | −10 | DevTools Protocol actif |
| VSync absent (<5 frames rAF) | −20 | Aucun compositeur graphique réel |
| VSync synthétique (variance < 0.001ms²) | −15 | Horloge artificielle |

**Seuil pour le fait `automation_anomaly` : score ≤ −40.** Les signaux `vsyncAbsent` (−20) et `vsyncSynthetic` (−15) en sont exclus — ils correspondent aux faux positifs du mode vie-privée de Firefox.

### L6 — Biométrie comportementale

Analyse comportementale des événements souris et clavier collectés pendant le défi PoW.

| Signal | Pénalité | Notes |
|---|---|---|
| Aucune interaction (souris, tactile, ni clavier) | −40 | Normal sur PoW rapide — pas bloquable seul |
| Saut >300px en <50ms | −70 | Clic par coordonnées VLM |
| Trajectoire parfaitement linéaire | −60 | Chemin généré algorithmiquement |
| Injection synthétique CDP (pression=0 ou géométrie=0) | −50 | Injection souris CDP |
| Jerk nul (trajectoire lissée) | −80 | Génération numérique |
| Cadence de frappe plate (dwell times identiques) | −40 | Frappes injectées |
| Frappe surhumaine (<8ms de vol moyen) | −40 | Injection en rafale |
| Mouvements sans clic | −5 | Intentionnellement faible — humains naviguent sans cliquer |
| Clavier sans pointeur | −5 | Accessibilité — très faible |

### L7 — Token de session

Après PoW réussi + validation pipeline, un JWT opaque est émis en cookie `HttpOnly, SameSite: Strict`.

Le token contient un **`sessionSeed`** — une valeur d'entropie unique par visiteur utilisée par `refract()` pour générer des filigranes déterministes dans les champs cosmétiques des API. Le seed ne change jamais pour un visiteur donné, rendant les datasets leakés attribuables à une session précise.

---

## Moteur de contradictions causales

14 règles évaluent la plausibilité causale sur 8 groupes de signaux indépendants. Une contradiction n'est actionnable que quand **deux groupes différents ou plus** se déclenchent.

| # | Règle | Sévérité | Groupe indépendant |
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

**Doctrine de corroboration :**
- **1 CRITICAL** → bloqué immédiatement (Zero Bot Mode) ou decoy
- **≥2 HIGH de groupes différents** → bloqué (Zero Bot Mode) ou decoy
- **1 HIGH d'un seul groupe** → watermarked (token accordé, données empoisonnées)
- **MEDIUM seulement** → watermarked
- **0 contradiction, humanValidated** → normal

---

## Flux de décision

```
decideReality(session) → une de 6 réalités :

blocked       → 403. La session reçoit un strike de réputation.
                Conditions : contradiction CRITICAL OU ≥2 groupes HIGH indépendants (Zero Bot Mode)

decoy         → 200 OK. La session reçoit des données délibérément fausses.
                Conditions : idem blocked mais Zero Bot Mode désactivé

watermarked   → 200 OK. Données réelles + filigrane + champs honeypot injectés.
                Conditions : 1 groupe HIGH OU toute contradiction MEDIUM

observed      → 200 OK. Données réelles + filigrane. Pas d'injection honeypot.
                Conditions : idem watermarked mais Zero Bot Mode désactivé

gate_required → Redirection vers gateway.html (PoW Argon2id)
                Conditions : pas de CRITICAL/HIGH, mais session non encore humanValidated

normal        → Accès complet. Réfraction légère uniquement.
                Conditions : humanValidated = true, cohérence propre
```

La valeur `suspicion` (0.0 – 1.0) est disponible sur `req.visitor.suspicion` pour du routage fin dans ton application.

---

## Protection des données & L'Univers Genèse

Prisme ne se contente pas de bloquer les bots, il les enferme dans ce que nous appelons **L'Univers Genèse** : un univers parallèle de fausses données généré dynamiquement. Si un bot passe la porte (Zero Bot Mode désactivé ou par du click-farming humain), il ne capture jamais la réalité.

### Moteur de réfraction

Toute réponse API passe par `refract(data, policy, sessionSeed, epoch)`. L'affichage côté client est intrinsèquement lié à cette réfraction, ce qui rend également les **captures d'écran (Screenshots) et l'OCR totalement inutiles et périssables**.

```js
const { refract, currentEpoch } = require('./prism-sdk/src/server/refractor');

const POLICY_PRODUITS = {
  id:          'actionable',  // Exact — humains et bots voient la même valeur
  prix:        'actionable',  // Exact — jamais modifié
  nom:         'cosmetic',    // Filigrane par session (substitution de synonymes)
  description: 'cosmetic',   // Filigrane par session
  rang:        'aggregate',   // Poison par item+epoch (la moyenne inter-sessions = poisonné)
  vues:        'aggregate',   // Poison par item+epoch
};

app.get('/api/produits', requireHuman, (req, res) => {
  const data = refract(produits, POLICY_PRODUITS, req.visitor.internalSeed, currentEpoch());
  res.json(data);
});
```

### Les trois politiques de champ

| Politique | Mécanisme | Impact humain | Impact bot |
|---|---|---|---|
| `actionable` | Exact — jamais modifié | Zéro | Zéro (ce champ est sûr à exposer) |
| `cosmetic` | Filigrane synonyme par session | Lit "robuste" au lieu de "solide" | Les fuites sont attribuées à la session source |
| `aggregate` | Décalage structurel par item+epoch | Zéro | Moyenne de 1 000 sessions = valeur empoisonnée |

### Pourquoi le poison agrégé résiste à la moyenne

Le bruit aléatoire par session s'annule quand on moyenne :
```
Session A: rang=4, Session B: rang=2, Session C: rang=3 → moyenne ≈ 3 (vraie valeur)
```

Le poison lié à l'epoch est **identique pour toutes les sessions** dans une fenêtre temporelle :
```
Session A: rang=5, Session B: rang=5, Session C: rang=5 → moyenne = 5 (valeur empoisonnée)
```

Le dataset d'entraînement d'un scraper est systématiquement faux — pas aléatoirement bruité.

### Injection honeypot

Les sessions suspectes (`decoy` ou `watermarked`) reçoivent des champs supplémentaires dans les réponses API :

```json
{
  "id": "svc-1",
  "nom": "API Principale",
  "__ghost_rank": 7,
  "__trap_api": "/__internal/v2/stats"
}
```

Un bot qui suit `__trap_api` déclenche le honeypot, reçoit un strike de réputation, et sa session passe à `blocked`.

---

## Défenses contre les bots screenshot

Les bots screenshot visitent le site comme des humains, rendent la page complète, prennent une capture d'écran et l'envoient aux hébergeurs pour signaler le site. Ils ne scrape pas — ils ont juste besoin d'un visuel.

### 1. Anonymisation de la gateway

`gateway.html` ne contient aucune marque, aucun nom de service, aucune information identifiable. Une capture d'écran ne révèle qu'un spinner sur fond sombre.

### 2. Révélation paresseuse de la landing page

Un overlay opaque (`#0a0f1e`, `z-index: 999999`) couvre toute la landing page au chargement. Il est retiré seulement au premier événement d'interaction humaine :

```
mousemove | touchstart | scroll | keydown  →  overlay fade out (0.4s)
3 secondes sans interaction                →  révélation automatique (humains immobiles)
```

Les bots screenshot qui capturent immédiatement voient un écran noir. Le fallback 3 secondes garantit que les vrais utilisateurs immobiles ne restent pas bloqués.

### 3. Détection d'écran physique (profil écran L4)

Collecté via `getScreenProfile()` dans le défi gateway. Détecte les appareils sans vrai écran physique :

```js
// Côté client (gateway.html)
function getScreenProfile() {
  return {
    rafMean:       /* intervalle rAF moyen en ms */,
    rafSamples:    /* nombre de frames rAF valides */,
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

## Dashboard Admin

Disponible sur `/admin` (nécessite l'en-tête `x-admin-token` ou connexion).

**Onglet Vue d'ensemble :** stats de flotte en direct (posture, taux allow/block, distribution de suspicion, activité honeypot).

**Onglet Visiteurs :** détail par session — IP, score, décomposition par couche, liste de contradictions, label de réalité.

**Onglet Logs :** journal d'événements glissant avec raisons préfixées par couche.

**Télécharger le rapport :** snapshot JSON complet via `GET /api/admin/report` — inclut posture, visiteurs, événements, stats honeypot, contradictions causales.

**Alertes Telegram :** notifications en temps réel sur les blocages de bots et l'activité suspecte.

---

## Démarrage rapide

```bash
git clone <ce repo>
cd antibotsite
npm install
cp .env.example .env
# Éditer .env : définir SECRET_KEY et ADMIN_TOKEN
npm start
# → http://localhost:3000
```

**Développement (redémarrage automatique) :**
```bash
npm run dev
```

**Tests :**
```bash
npm test
```

---

## Guide d'intégration

### Ajouter Prisme à un projet Express existant

**Étape 1 — Installer les dépendances**

```bash
npm install argon2 cookie-parser helmet express-rate-limit
```

**Étape 2 — Copier les répertoires antibot**

```
ton-projet/
  src/
    antibot/          ← copier ce répertoire complet
    layers/           ← copier ce répertoire complet
    config/tuning.js  ← copier et ajuster les seuils
    policy/           ← copier verdict.js et posture.js
    store/            ← copier visitors.js, reputation.js, events.js, nonces.js
  prism-sdk/          ← copier ce répertoire complet
  public/
    argon2.min.js     ← requis côté client
    argon2.wasm       ← requis côté client
```

**Étape 3 — Enregistrer les middlewares**

```js
const express      = require('express');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const L1_network   = require('./layers/L1_network');
const antibotEntry = require('./antibot/middleware/antibotEntry');

const app = express();

app.use(helmet());
app.use(cookieParser());
app.use(express.json());

// Limite globale
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

// L1 — signaux réseau (lecture seule, ne bloque pas seul)
app.use(L1_network.analyze);

// Session Prisme + pipeline causal
app.use(antibotEntry);
```

**Étape 4 — Ajouter les routes de gateway**

```js
const validationController = require('./controllers/validationController');
const L7_session           = require('./layers/L7_session');

// Endpoints PoW (publics — pas de gate)
router.get('/api/challenge-config',    validationController.getChallengeConfig);
router.post('/api/verify-challenge',   validationController.verifyChallenge);
router.post('/api/feedback-invisible', validationController.recordSilentFeedback);

// Middleware gate humain
const requireHuman = (req, res, next) => {
  const jwt = L7_session.verifyToken(req.cookies['human_auth_token']);
  if (jwt.valid) return next();
  if (req.visitor?.humanValidated) return next();
  return res.status(401).json({ error: 'human_session_required' });
};
```

**Étape 5 — Servir la gateway**

```js
app.get('/gateway', (req, res) => res.sendFile('gateway.html'));

// Toutes les pages protégées passent par requireHuman
app.get('/', requireHuman, (req, res) => res.sendFile('landing.html'));
app.get('/app', requireHuman, (req, res) => res.sendFile('app.html'));
```

**Étape 6 — Envelopper toutes les réponses API**

```js
const { refract, currentEpoch } = require('./prism-sdk/src/server/refractor');
const { getSessionSeed }        = require('./middlewares/prismAdapter');

// Définir ta politique de champs
const MA_POLICY = {
  id:          'actionable',  // Toujours exact
  prix:        'actionable',  // Toujours exact
  nom:         'cosmetic',    // Filigrane traçable
  description: 'cosmetic',   // Filigrane traçable
  rang:        'aggregate',   // Empoisonné — résiste à la moyenne
};

app.get('/api/produits', requireHuman, (req, res) => {
  const seed = getSessionSeed(req);
  const data = refract(rawProduits, MA_POLICY, seed, currentEpoch());
  res.json(data);
});
```

**Étape 7 — Copier la gateway HTML**

Copier `src/views/gateway.html` et `public/argon2.min.js` / `argon2.wasm`. La gateway ne nécessite aucun framework — c'est un fichier HTML autonome avec une IIFE inline.

**Étape 8 — Ajouter l'overlay de révélation paresseuse**

Coller ceci immédiatement après ta balise `<body>` sur ta landing page :

```html
<script>!function(){var g=document.createElement('div');g.id='__sgrd';g.style.cssText='position:fixed;inset:0;background:#0a0f1e;z-index:999999;pointer-events:none;transition:opacity 0.4s ease;';document.body.appendChild(g);var done=false;function reveal(){if(done)return;done=true;g.style.opacity='0';setTimeout(function(){if(g.parentNode)g.parentNode.removeChild(g);},400);['mousemove','touchstart','scroll','keydown'].forEach(function(e){document.removeEventListener(e,reveal,true);});}['mousemove','touchstart','scroll','keydown'].forEach(function(e){document.addEventListener(e,reveal,{once:true,passive:true,capture:true});});setTimeout(reveal,3000);}();</script>
```

Changer `background:#0a0f1e` pour correspondre à la couleur de fond de ton site.

### Edge / Serverless (Cloudflare Workers)

```js
// edge/worker.js
const { analyzeRequest } = require('./src/antibot/core/prismeCore');

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const decision = analyzeRequest({
    path:           new URL(request.url).pathname,
    method:         request.method,
    userAgent:      request.headers.get('user-agent'),
    cookieHeader:   request.headers.get('cookie'),
    humanValidated: false,
  });

  if (decision.action === 'deny') return new Response('Accès restreint', { status: 403 });
  if (decision.action === 'gate') return Response.redirect('/gateway');

  return fetch(request);
}
```

---

## Référence de configuration

### Variables d'environnement

| Variable | Requise | Défaut | Description |
|---|---|---|---|
| `SECRET_KEY` | Oui | aléatoire (sessions reset au redémarrage) | Clé de signature JWT |
| `ADMIN_TOKEN` | Oui | aléatoire (affiché au démarrage) | Token bearer dashboard admin |
| `ANTIBOT_ZERO_BOT_MODE` | Non | `true` | `false` → filigrane seulement, jamais de blocage |
| `PORT` | Non | `3000` | Port d'écoute HTTP |
| `NODE_ENV` | Non | `development` | `production` active les cookies `Secure` |
| `TELEGRAM_BOT_TOKEN` | Non | — | Token du bot Telegram pour les alertes |
| `TELEGRAM_CHAT_ID` | Non | — | ID du chat/canal Telegram pour les alertes |

### Calibration (`src/config/tuning.js`)

Tous les seuils numériques sont centralisés ici. Aucune valeur heuristique n'apparaît dans les fichiers de couches.

**Valeurs clés :**

```js
verdict: {
  trustThreshold:    60,   // score ≥ 60 → session humaine accordée
  strikeThreshold:   20,   // score < 20 → ban possible
  significantSignal: -15,  // contribution min. pour compter comme témoin
},

L4: {
  headlessRenderer:     -35,  // SwiftShader
  vdiRenderer:          -25,  // llvmpipe / Basic Render (plafonné avec absences)
  gpuOsMismatch:        -50,  // GPU Apple sur UA Windows, Adreno sur UA macOS, etc.
  webglRenderSlow:      -30,  // > 25ms/draw → renderer logiciel
  screenPointerNone:    -40,  // pointer:none
  screenMobileMismatch: -40,  // UA mobile + pointeur desktop ou sans tactile
  mobileUaDprLow:       -35,  // UA mobile + DPR ≤ 1.0
  sensorDesync:        -100,  // injection JS d'entrées
  batterySpoof:         -30,  // level > 1.0
},

L5: {
  webdriverNative: -100,  // navigator.webdriver = true
  firefoxDriver:    -40,  // attribut geckodriver
  vsyncAbsent:      -20,  // < 5 frames rAF
  vsyncSynthetic:   -15,  // variance < 0.001
},

L6: {
  noInteraction:   -40,  // aucune souris/tactile/clavier
  teleport:        -70,  // saut >300px en <50ms
  syntheticInject: -50,  // injection CDP pression=0
},
```

---

## Checklist sécurité

- [x] `robots.txt` → `Disallow: /` (tous les crawlers)
- [x] `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` sur toutes les réponses
- [x] Gate session humaine sur toutes les routes de contenu et API
- [x] APIs sensibles exigent `humanValidated: true`
- [x] Routes admin exigent l'en-tête `x-admin-token`
- [x] Cookie `human_auth_token` : `httpOnly`, `secure` (production), `SameSite: Strict`
- [x] `SECRET_KEY` depuis les variables d'env uniquement — jamais hardcodé
- [x] Toutes les réponses API passent par `refract()` — aucune donnée brute servie
- [x] Nonce serveur par défi PoW (usage unique, TTL 10 min) — anti-rejeu
- [x] Piège honeypot sur `/__internal/v2/stats`
- [x] Vérification CSRF sur `/api/feedback-invisible` (même origine seulement)
- [x] Extraction IP Cloudflare (`CF-Connecting-IP` validé contre les CIDR CF)
- [x] Limite globale : 60 req/min par IP
- [x] PoW Argon2id — opération de bots en masse économiquement non viable à difficulté 4+
- [x] Gateway anonymisée — aucune marque visible dans les captures d'écran
- [x] Révélation paresseuse landing — les bots screenshot voient uniquement un écran sombre
- [x] Seed de session dans le JWT — les fuites de données sont attribuables à la session source

---

## Limites honnêtes

**Un bot tournant sur un vrai appareil physique passe tout.**  
Un vrai MacBook faisant tourner Puppeteer a un vrai GPU Apple, un vrai DPR, une vraie cadence rAF. Le système ne peut pas le distinguer d'un humain. Cependant, louer 1 000 MacBooks pour scraper un site coûte des milliers d'euros par jour — c'est précisément le point. Prisme rend l'attaque non rentable, pas impossible.

**L'attribution du filigrane nécessite une ancre de vérité.**  
Si un scraper possède un item avec une valeur correcte connue depuis une autre source, il peut calculer le biais et dé-empoisonner les champs agrégés pour cet item. Le filigrane trace toujours la session source, et la qualité globale du dataset d'entraînement est dégradée.

**Le stockage est en mémoire.**  
Les sessions, la réputation et les événements sont dans des Maps Node.js — ils se réinitialisent au redémarrage et ne se partagent pas entre instances. Pour la production multi-instance, remplacer `sessionStore.js`, `reputation.js` et `visitors.js` par Redis.

**La seule barrière plus haute :** authentification + vérification d'identité/paiement + limitation par compte + conditions légales. Ça augmente la barre substantiellement — mais ça change aussi le produit.

---

## Licence

MIT
