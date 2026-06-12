# 🌈 Prisme SDK — Défense Anti-Scraping par l'Économie

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/prism-defense.svg)](https://badge.fury.io/js/prism-defense)

Prisme n'est pas un pare-feu. Prisme n'est pas un captcha. **Prisme est une arme d'ingénierie offensive.** 

L'architecture Prisme part d'un constat simple : la détection binaire ("Est-ce un bot ou un humain ?") est obsolète. Les bots modernes simulent parfaitement les comportements humains, rendent le JavaScript, et utilisent des proxys résidentiels. Tenter de les bloquer génère des faux positifs inacceptables pour vos vrais clients.

**Notre solution : Ne bloquez plus personne. Empoisonnez la donnée.**

Un humain regarde une interface visuelle. Un bot *doit* scraper la couche technique (JSON, DOM). Le SDK Prisme exploite cette unique différence irréductible pour tendre des pièges structurels et ruiner économiquement l'extraction de données.

---

## 🚀 Les 4 Piliers de l'Architecture

### 1. Réfraction Déterministe (Watermark & Jitter)
Au lieu de renvoyer la vérité absolue, le serveur "réfracte" la donnée selon une clé de session (`seed`). 
- **Les données d'agrégation (ex: rang)** subissent un micro-bruit ("Jitter"). Le scraper qui fusionne 10 sessions corrompt sa moyenne.
- **Les données cosmétiques (ex: descriptions)** utilisent des synonymes ("Watermark"). Si votre donnée fuite, vous pouvez identifier exactement la session source.
- **Les données critiques (ex: prix)** restent exactes (`actionable`). L'humain n'est jamais impacté.

### 2. Le Honeypot Structurel (Détection Certaine)
Le middleware injecte silencieusement des champs fantômes (ex: `__trap_api: "/api/stats"`) dans le JSON. Ces champs ne sont jamais affichés par l'UI. Si une session appelle ce lien, c'est **mathématiquement** un bot. La session est alors basculée en mode "Poison Total" sans jamais recevoir d'erreur 403 : le bot continue de télécharger des gigaoctets de fausses données en croyant que son script fonctionne.

### 3. L'Entropie Comportementale
Le SDK Client mesure silencieusement la loi de distribution Gamma de la souris et du scroll (Entropie de Shannon). Un bot simule des mouvements, mais rate la distribution mathématique humaine. Cette "chaleur" module le coût serveur.

### 4. Révélation Progressive (Fragmentation)
Les données "Joyaux" sont fragmentées. Le JSON contient la partie entière du prix, les CSS contiennent les centimes. L'assemblage n'existe que dans le navigateur humain via le SDK. Un bot doit simuler un moteur de rendu complet pour reconstituer la valeur.

---

## 📦 Installation

```bash
npm install prism-defense
```

---

## 🛠️ Utilisation Rapide

### 1. Côté Serveur (Express/Node.js)

Intégrez le middleware pour réfracter les réponses et injecter le Honeypot.

```javascript
const express = require('express');
const { prismMiddleware } = require('prism-defense/src/server');

const app = express();

// Définissez votre politique de données
const policy = {
    price: 'actionable',     // Exact
    description: 'cosmetic', // Synonymes (traçabilité)
    rank: 'aggregate'        // Bruit (destruction statistique)
};

// Utilisez le middleware
app.use('/api/products', prismMiddleware(policy));

app.get('/api/products', (req, res) => {
    // Renvoyez votre donnée pure. Le middleware s'occupe de la transformer.
    res.json([
        { id: 1, name: "Widget", price: 49.99, description: "Un objet robuste", rank: 5 }
    ]);
});
```

### 2. Le Piège (Honeypot)

N'oubliez pas d'attacher la route piège qui blacklist les bots.

```javascript
const { honeypotTrapMiddleware } = require('prism-defense/src/server');

// Cette route est injectée automatiquement dans le JSON généré par le middleware
app.get('/api/__internal/v2/stats/*', honeypotTrapMiddleware);
```

### 3. Côté Client (React, Vue, Vanilla)

Démarrez la collecte d'entropie sans bloquer le rendu.

```javascript
import { initPrismClient } from 'prism-defense/src/client';

// Au chargement de l'application
const prism = initPrismClient({
    onEntropyUpdate: (score) => {
        // Envoi silencieux au backend pour ajuster la chaleur
        fetch('/api/beacon/entropy', { method: 'POST', body: JSON.stringify({ score }) });
    }
});
```

---

## 📖 Documentation Détaillée

Consultez le dossier `/docs` pour lire la philosophie complète et les diagrammes explicatifs :
- [L'Architecture Prisme de base](docs/guide_architecture_prisme.md)
- [Les concepts avancés (Honeypot, Entropie)](docs/prisme_avance.md)

---

## ⚠️ Pourquoi c'est le cauchemar des Scrapers ?

| Action du Scraper | Résultat |
|---|---|
| Contourne le Captcha | Télécharge des données empoisonnées au Jitter. Sa Data Science s'effondre. |
| Utilise 50 Proxys IP | Le Watermark unique le trahit juridiquement dès qu'il revend la donnée. |
| Parse le JSON brutalement | Tombe dans le Honeypot Structurel. Reçoit un Poison Total de 100%. |
| Lance Chrome Headless | Échoue à la vérification d'Entropie Gamma et subit un PoW ruinant son CPU Cloud. |

Le chasseur est devenu la proie.

---

## Licence

MIT. Protégez vos données.
