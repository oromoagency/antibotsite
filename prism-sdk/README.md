# 🌈 Prisme SDK — Défense Anti-Scraping par l'Économie

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Prisme n'est pas un pare-feu classique. Prisme n'est pas un énième Captcha. **Prisme est une arme d'ingénierie offensive.** 

L'architecture Prisme part d'un constat simple : la détection binaire ("Est-ce un bot ou un humain ?") est obsolète. Les bots modernes simulent parfaitement les comportements humains, rendent le JavaScript, et utilisent des proxys résidentiels. Tenter de les bloquer génère des faux positifs inacceptables pour vos vrais clients.

**Notre solution : Ne bloquez plus aveuglément. Empoisonnez la donnée.**

Le SDK Prisme offre **deux modes de fonctionnement** : un Bouclier L1-L7 complet "clés en main" (Le Gateway), ou un accès "à la carte" à son redoutable moteur de réfraction de données.

---

## 🚀 Les Piliers de l'Architecture

### 1. Réfraction Déterministe (Watermark & Jitter)
Au lieu de renvoyer la vérité absolue, le serveur "réfracte" la donnée selon une clé de session. 
- **Les données d'agrégation** subissent un micro-bruit ("Jitter"). Le scraper corrompt sa base de données statistique.
- **Les données cosmétiques** utilisent des synonymes ("Watermark"). Si votre donnée fuite, vous pouvez identifier exactement la source.

### 2. Le Honeypot Structurel
Le middleware injecte silencieusement des liens fantômes dans le JSON (jamais affichés par l'UI). Si un script l'appelle, c'est **mathématiquement** un bot. Il est alors basculé en mode "Poison Total" sans erreur 403 : le bot télécharge des giga-octets de fausses données en croyant réussir.

### 3. Gateway "Zero Bot" et Orchestrateur Causal (L1-L7)
Une suite de couches (L1 Réseau, L2 Réputation, L3 Proof-of-Work cryptographique Argon2) qui garantit l'authenticité de chaque requête via un Token Session vérifié.

---

## 📦 Installation

*(Le SDK est actuellement en version locale)*

```bash
npm install ./prism-sdk
```

---

## 🛠️ Usage : Deux Niveaux d'Intégration

Prisme SDK s'adapte à votre architecture. Vous pouvez l'utiliser comme un pare-feu complet, ou seulement utiliser son algorithme de réfraction si vous possédez déjà un WAF.

### Mode 1 : Intégration Complète (`PrismeShield`)
*Idéal si vous voulez protéger l'ensemble de votre backend (API, Pages) avec le moteur Causal L1-L7, le challenge PoW et le Dashboard inclus.*

```javascript
const express = require('express');
const { PrismeShield } = require('prism-sdk');

const app = express();

// Déployer le bouclier en tête de votre application
app.use(PrismeShield({
    adminToken: process.env.ADMIN_TOKEN, // Accès au Dashboard d'observabilité
    challengeDifficulty: 100000,         // Difficulté du Proof-of-Work
    telegramBotToken: process.env.TG_BOT_TOKEN, // Alertes (Optionnel)
    telegramChatId: process.env.TG_CHAT_ID,
    zeroBotMode: true                    // Bloquer strictement les UAs de bots connus
}));

// Vos routes derrière le bouclier (nécessite une session validée)
app.get('/api/secure-data', (req, res) => {
    res.json({ secret: "Donnée protégée par l'Orchestrateur Causal" });
});

app.listen(3000);
```

### Mode 2 : Intégration "À la carte" (`prismMiddleware` / `refract`)
*Idéal si un dev (L1-L6 propre à lui) veut uniquement intégrer la magie de Prisme à son antibot ou son site.*

```javascript
const express = require('express');
const { prismMiddleware, honeypotTrapMiddleware } = require('prism-sdk');

const app = express();

// Politique de réfraction
const policy = {
    price: 'actionable',     // Reste exact
    description: 'cosmetic', // Modifié par des synonymes (Watermark)
    rank: 'aggregate'        // Bruit mathématique (Jitter)
};

// 1. Attacher la route piège qui repère les bots
app.use('/__internal/v2/stats', honeypotTrapMiddleware);

// 2. Protéger l'API cible
app.use('/api/products', prismMiddleware(policy));

app.get('/api/products', (req, res) => {
    // Renvoyez votre donnée pure. Le middleware s'occupe de la corrompre
    // ou de l'empoisonner selon la session du visiteur.
    res.json([
        { id: 1, name: "Widget", price: 49.99, description: "Un objet robuste", rank: 5 }
    ]);
});
```

---

## 📊 Dashboard d'Observabilité Inclus

Si vous utilisez le mode `PrismeShield`, des routes d'administration sont exposées (protégées par `adminToken`) :
- `GET /api/admin/stats` : Vue synthétique de la flotte.
- `GET /api/admin/report` : Extraction complète de la télémétrie.
- `GET /api/admin/visitors` : État causal de toutes les sessions.
- `GET /api/admin/logs` : Historique des événements de sécurité.

---

## ⚠️ Pourquoi c'est le cauchemar des Scrapers ?

| Action du Scraper | Résultat |
|---|---|
| Contourne le Captcha/PoW | Télécharge des données empoisonnées au Jitter. Sa base de données perd toute fiabilité. |
| Utilise 50 Proxys IP | Le Watermark unique dans le texte le trahit juridiquement dès qu'il revend la donnée. |
| Parse le JSON brutalement | Tombe dans le Honeypot Structurel. Reçoit un Poison Total. |
| Lance Chrome Headless | Échoue au test biométrique/entropie et subit un Proof-of-Work ruinant son CPU Cloud. |

Le chasseur est devenu la proie.

---

## Licence

MIT. Protégez vos données.
