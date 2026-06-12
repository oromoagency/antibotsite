# 🛡️ AntibotSite & Architecture Prisme

Un système de protection anti-bot **enterprise-grade** conçu pour distinguer les humains des bots avec précision chirurgicale — sans CAPTCHA, sans friction inutile.

Ce projet inclut une implémentation complète de **l'Architecture Prisme**, un changement de paradigme dans la lutte anti-scraping : **on ne bloque plus les bots, on les empoisonne silencieusement.**

> **Doctrine fondamentale** : L'objectif n'est pas de bloquer la requête, mais de rendre la donnée volée incohérente, tout en forçant l'attaquant à consommer d'énormes ressources de calcul pour l'obtenir.

---

## 🌈 Le Prisme SDK : Défense Offensive

Au lieu d'utiliser des murs (403 Forbidden, CAPTCHA) qui génèrent des faux positifs, l'API utilise le **Prisme SDK** intégré. Le serveur agit comme un prisme optique : il réfracte la donnée selon le visiteur.

### 1. Réfraction des Données (Poisoning)
Lorsqu'un bot attaque une API (ex: `/api/prism/demo`), la donnée renvoyée est modifiée dynamiquement :
- **🛡️ Actionable Data** (ex: UUID, prix final) : Reste intacte pour ne pas casser le front-end.
- **💄 Cosmetic Data** (ex: descriptions, URLs) : Se voit injecter un *Watermark* invisible (des espaces insécables, des caractères unicode homoglyphes) généré à partir de l'IP du visiteur. Si la base fuite, on peut identifier le bot.
- **🎲 Aggregate Data** (ex: nombre de vues, compteurs) : Subit un *Jitter* (bruit mathématique). Les bots qui agrègent ces données pour de la veille concurrentielle récoltent des statistiques faussées.

### 2. Entropie Comportementale (Client-Side)
Un bot simule des clics parfaits. Le SDK client (`prism.js`) traque l'entropie de Shannon des mouvements de souris et du défilement. Un humain est chaotique (haute entropie), un script Playwright est linéaire (basse entropie). Ce score de suspicion module la friction serveur.

### 3. Honeypot Structurel (Piège Invisible)
Des routes API fantômes (ex: `/__internal/v2/stats/`) sont injectées dynamiquement dans les requêtes JSON légitimes. Le Frontend humain ignore ces clés. Un crawler, voyant une URL d'API, va tenter de l'explorer. Dès qu'il la touche, son IP est marquée comme `BOT` définitif avec un score de suspicion maximal.

---

## 🏗️ Architecture Globale (7 Couches)

```
Requête HTTP
    ↓
[Rate Limiter]  100 req / 15 min
    ↓
[L1 — Réseau]   Headers HTTP, casse UA, 80+ UA bots connus
    ↓
[L2 — Accès]    IP bannie → Friction max / Honeypot
    ↓
POST /api/verify-challenge
    ↓
[Orchestrateur] → L1+TLS → L2 → L3 → L4 → L5 → L6 → Verdict
    ↓
[L7 — Session]  Token AES chiffré → cookie httpOnly
    ↓
protected_app.html ✅ (ou données réfractées si suspicion modérée)
```

### 🔢 Les 7 couches de détection

| Couche | Spécialité | Signaux clés |
|--------|-----------|-------------|
| **L1** Network + TLS | Anomalies protocolaires | Ordre headers, UA bot, JA4 fingerprint |
| **L2** Accès & Réputation | Qui, d'où, à quelle cadence | IP datacenter, vélocité tentatives |
| **L3** Proof of Work | Anti-brute-force | Argon2id 4MB RAM, nonce serveur |
| **L4** Empreinte matérielle | Environnement physique | WebGL renderer, Canvas, AudioContext |
| **L5** Automatisation | Frameworks de pilotage | WebDriver, CDP pièges, geckodriver |
| **L6** Biométrie (Prisme) | Entropie de Shannon | Jerk souris, téléportation, frappe clavier |
| **L7** Session | Continuité d'accès | Token AES, empreinte liée, expiration |

---

## ⚖️ Système de score & Décisions

Chaque requête part avec un score de **100** et descend selon les signaux détectés :

| Score | Décision (Voie / Lane) |
|-------|----------|
| ≥ 60 | 🟢 **RICH** : Accès accordé + token de session. Données brutes et PoW léger. |
| < 60 | 🟠 **ACCESSIBLE** : Suspect. Friction réseau artificielle + Données réfractées (bruitées). |
| < 20 | 🔴 **TRAP** : Bot identifié. Fake API (Honeypot), poison de données maximal, CPU burn (Argon2id max). |

---

## 🚀 Installation & Intégration

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
Le Dashboard Admin est accessible sur `/admin` avec le token `ADMIN_TOKEN`.

### Intégration du SDK Prisme Client (Frontend)

Insérez simplement ce script dans votre balise `<head>` ou en fin de `<body>` pour activer l'Entropie Comportementale :

```html
<script src="/prism.js"></script>
<script>
    document.addEventListener('DOMContentLoaded', () => {
        window.PrismSDK.init({
            onEntropy: (score) => {
                // Envoi du score de chaos mathématique au serveur
                fetch('/api/track/event', {
                    method: 'POST',
                    body: JSON.stringify({ type: 'prism_entropy', data: { score } })
                });
            }
        });
    });
</script>
```

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

## 📚 En savoir plus sur la logique Prisme

Nous avons rédigé deux guides complets expliquant l'architecture en détail, disponibles dans le dossier `prism-sdk/docs/` :
- [Guide d'Architecture Prisme (Simple et Visuel)](prism-sdk/docs/guide_architecture_prisme.md)
- [Algorithmes et Implémentation Avancée](prism-sdk/docs/prisme_avance.md)

---

## 📄 Licence

MIT — Libre d'utilisation, modification et distribution.

## 🤝 Contribution

Les issues et pull requests sont les bienvenues. Pour les changements majeurs, ouvrez d'abord une issue pour discuter de ce que vous souhaitez modifier.
