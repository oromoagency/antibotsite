# 🛡️ AntibotSite

Un système de protection anti-bot **enterprise-grade** conçu pour distinguer les humains des bots avec précision chirurgicale — sans CAPTCHA, sans friction inutile.

> **Doctrine fondamentale** : Un seul signal ne suffit jamais à bloquer quelqu'un. Seule l'accumulation cohérente de plusieurs signaux indépendants permet une décision fiable.

---

## ✨ Fonctionnalités

- 🔬 **7 couches de détection** indépendantes et spécialisées
- 🧮 **Proof of Work Argon2id** memory-hard (neutralise les GPU farms)
- 🧬 **Biométrie comportementale** : trajectoire souris, dynamique de frappe
- 🤖 **Détection d'automatisation** : Puppeteer, Playwright, Selenium, nodriver
- 🖥️ **Empreinte matérielle** : WebGL, Canvas, AudioContext, WebGPU
- 🌐 **Intelligence de flotte** : posture adaptative sous attaque distribuée
- 🍯 **Pièges honeypot** : LLM injection, formulaires fantômes, boutons invisibles
- 🌈 **Prisme SDK Intégré** : Réfraction de données (Jitter/Watermark), Révélation Progressive, Entropie Comportementale et Honeypot Structurel.
- 🔐 **Sessions chiffrées** : tokens AES-256, anti-CSRF, durée 2h
- 📊 **Tableau de bord admin** : observabilité en temps réel
- ✅ **Anti-faux-positifs** : navigateurs vie-privée, RDP, accessibilité, CGNAT

---

## 🏗️ Architecture

```
Requête HTTP
    ↓
[Rate Limiter]  100 req / 15 min
    ↓
[L1 — Réseau]   Headers HTTP, casse UA, 80+ UA bots connus
    ↓
[L2 — Accès]    IP bannie → 403 immédiat
    ↓
POST /api/verify-challenge
    ↓
[Orchestrateur] → L1+TLS → L2 → L3 → L4 → L5 → L6 → Verdict
    ↓
[L7 — Session]  Token AES chiffré → cookie httpOnly
    ↓
protected_app.html ✅
```

---

## 🔢 Les 7 couches de détection

| Couche | Spécialité | Signaux clés |
|--------|-----------|-------------|
| **L1** Network + TLS | Anomalies protocolaires | Ordre headers, UA bot, JA4 fingerprint |
| **L2** Accès & Réputation | Qui, d'où, à quelle cadence | IP datacenter, vélocité tentatives |
| **L3** Proof of Work | Anti-brute-force, anti-rejeu | Argon2id 4MB RAM, nonce serveur, télémétrie |
| **L4** Empreinte matérielle | Cohérence environnement physique | WebGL renderer, Canvas, AudioContext, WebGPU |
| **L5** Automatisation | Frameworks de pilotage | WebDriver, CDP pièges, geckodriver, VSync |
| **L6** Biométrie | Comportement humain | Jerk souris, téléportation, frappe clavier |
| **L7** Session | Continuité d'accès | Token AES, empreinte liée, expiration 2h |

---

## ⚖️ Système de score

Chaque requête part avec un score de **100** et descend selon les signaux détectés :

| Score | Décision |
|-------|----------|
| ≥ 60 | ✅ Accès accordé + token de session |
| < 60 | 🚫 Bloqué (403, retryable immédiatement) |
| < 20 **ET** (signal déclaratif **OU** ≥ 2 couches) | ⛔ Banni (strike + ban temporaire) |

### Exemples de pénalités

| Signal | Pénalité |
|--------|----------|
| UA bot connu (Googlebot, GPTBot, curl…) | -100 |
| `navigator.webdriver = true` | -100 |
| Artefacts ChromeDriver (`$cdc_`) | -80 |
| Télémétrie biométrique rejouée | -80 |
| Zéro interaction humaine | -85 |
| Piège CDP Proxy déclenché | -45 |
| IP datacenter (AWS/GCP/Azure) | -15 |

---

## 🧮 Proof of Work Argon2id

**Pourquoi Argon2id et non SHA-256 ?**

SHA-256 est parallélisable à l'infini par un GPU (10 000 cœurs → résolution en 3ms). Argon2id impose **4 MB de RAM par tentative** : un GPU ne peut pas paralléliser davantage que sa RAM vidéo totale le permet.

```
SHA-256 :  Humain 500ms ✅ | GPU farm 3ms ❌ (passe)
Argon2id : Humain 600ms ✅ | GPU farm 600ms ✅ (bloqué)
```

**Paramètres** : `mem=4096 kB`, `time=2`, `parallelism=1`, `type=Argon2id`

---

## 🌡️ Posture adaptative

Le système surveille la **flotte entière** (pas juste une requête) sur une fenêtre de 5 minutes :

| Niveau | Déclencheur | Action |
|--------|------------|--------|
| CALME | — | Difficulté PoW = 4 |
| VIGILANCE | 12 hostiles ou 4 IPs hostiles | Difficulté = 5 (×16 coût CPU) |
| ATTAQUE | 40 hostiles ou 10 IPs hostiles | Difficulté = 5 + alerte admin |

---

## 🍯 Pièges honeypot (4 types)

1. **LLM Injection** : texte invisible qui ordonne à un agent IA de cliquer sur un lien piège
2. **Lien caché** : invisible aux humains (`position: absolute; left: -9999px`), suivi par les crawlers
3. **Formulaire fantôme** : déclenche les bots de credential stuffing
4. **Bouton invisible** : 8×8px opacité 0.01%, jamais cliqué par un humain

---

## 🚀 Installation

### Prérequis
- Node.js ≥ 18
- npm ≥ 9

### Démarrage local

```bash
# Cloner le dépôt
git clone https://github.com/oromoagency/antibotsite.git
cd antibotsite

# Installer les dépendances
npm install

# Démarrer le serveur
SECRET_KEY=votre_secret_ici ADMIN_TOKEN=votre_token_admin node src/server.js
```

Le serveur démarre sur **http://localhost:3000** (port configurable via `PORT`).

---

## ⚙️ Variables d'environnement

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `SECRET_KEY` | Clé de chiffrement AES des tokens de session | Recommandé en prod |
| `ADMIN_TOKEN` | Token d'accès au tableau de bord `/admin` | Recommandé en prod |
| `PORT` | Port d'écoute du serveur | Non (défaut: 3000) |

> ⚠️ Si `SECRET_KEY` est absent, un secret aléatoire est généré au démarrage — les sessions sont invalidées à chaque redémarrage.

---

## ☁️ Déploiement sur Render

1. Fork ce dépôt sur votre compte GitHub
2. Connectez-vous sur [Render.com](https://render.com/)
3. **New** > **Web Service** > connectez votre dépôt
4. Paramètres :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
5. Variables d'environnement :
   - `SECRET_KEY` = (chaîne aléatoire longue)
   - `ADMIN_TOKEN` = (votre mot de passe admin)
6. Cliquez sur **Create Web Service**

---

## 📁 Structure du projet

```
antibotsite/
├── src/
│   ├── server.js              # Point d'entrée Express
│   ├── config/
│   │   └── index.js           # Configuration (port, clés)
│   ├── layers/
│   │   ├── L1_network.js      # Analyse headers HTTP & UA bots
│   │   ├── L1_tls.js          # Empreinte TLS / JA4
│   │   ├── L2_access.js       # Réputation IP & vélocité
│   │   ├── L3_pow.js          # Proof of Work Argon2id
│   │   ├── L4_hardware.js     # Empreinte matérielle (WebGL/Canvas/Audio)
│   │   ├── L5_automation.js   # Détection WebDriver/CDP
│   │   ├── L6_biometrics.js   # Biométrie comportementale
│   │   └── L7_session.js      # Tokens de session chiffrés
│   ├── policy/
│   │   ├── verdict.js         # Agrégation des scores + décision
│   │   └── posture.js         # Intelligence de flotte adaptative
│   ├── controllers/
│   │   ├── validationController.js  # Orchestrateur principal
│   │   └── adminController.js       # Tableau de bord
│   ├── routes/
│   │   ├── api.js             # Routes API REST
│   │   └── web.js             # Routes web (gateway, app)
│   ├── store/
│   │   ├── reputation.js      # Gestion des bans et strikes
│   │   ├── nonces.js          # Anti-rejeu des nonces PoW
│   │   ├── telemetry.js       # Empreintes biométriques
│   │   └── events.js          # Journal des verdicts
│   └── views/
│       ├── gateway.html       # Page de challenge (Argon2 + biométrie)
│       ├── protected_app.html # Application protégée
│       └── admin.html         # Tableau de bord opérateur
├── public/                    # Assets statiques
├── tests/                     # Tests par phase
└── package.json
```

---

## 🔌 API

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `GET /` | GET | Gateway ou app protégée (selon session) |
| `GET /api/challenge-config` | GET | Difficulté PoW + nonce serveur |
| `POST /api/verify-challenge` | POST | Vérification complète (L1→L6) |
| `POST /api/feedback-invisible` | POST | Piège honeypot |
| `GET /admin` | GET | Tableau de bord (nécessite `x-admin-token`) |

---

## 🤖 Bots détectés et bloqués

### Par User-Agent (L1)
- **Moteurs de recherche** : Googlebot, Bingbot, Yandex, Baidu, DuckDuckBot…
- **Crawlers IA/LLM** : GPTBot, ClaudeBot, Meta-ExternalAgent, Perplexitybot…
- **Scanners de vulnérabilités** : Nikto, Nessus, SQLmap, Nuclei, OWASP ZAP…
- **Outils SEO** : Ahrefsbot, SEMrushbot, Mj12bot…
- **Bibliothèques HTTP** : python-requests, curl, wget, axios, node-fetch…
- **Réseaux sociaux** : Facebookexternalhit, Twitterbot, Discordbot…
- **Scanners réseau** : Shodan, Censys, ZoomEye

### Par comportement (L4-L6)
- **Puppeteer / Playwright** (avec ou sans patches furtivité)
- **Selenium / ChromeDriver** (natif et patché)
- **nodriver** (contournement de puppeteer)
- **Camoufox** (Firefox patchée pour l'automatisation)
- **Agents LLM visuels** (GPT-4o vision, Claude vision)
- **Scripts HTTP bruts** (aucune interaction)

---

## 🛡️ Anti-faux-positifs

Le système est conçu pour ne jamais bloquer ces profils légitimes :
- 🔒 **Navigateurs vie-privée** : Brave (farbling), Firefox RFP, Tor
- 🖥️ **Environnements professionnels** : Remote Desktop (RDP), VDI
- ♿ **Accessibilité** : lecteurs d'écran NVDA/JAWS, navigation clavier seul
- 🏢 **Entreprises** : Proxys SSL, CGNAT (plusieurs humains derrière une IP)
- 📱 **Mobiles bas de gamme** : peu d'événements souris, minage PoW lent

---

## 📄 Licence

MIT — Libre d'utilisation, modification et distribution.

---

## 🤝 Contribution

Les issues et pull requests sont les bienvenues. Pour les changements majeurs, ouvrez d'abord une issue pour discuter de ce que vous souhaitez modifier.
