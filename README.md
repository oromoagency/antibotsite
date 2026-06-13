# Prisme Antibot & Univers Genèse

**Moteur de cybersécurité comportementale et visuelle pour Node.js / Express.**  
Prisme ne se contente pas de bloquer les bots : il les enferme dans une fausse réalité mathématiquement corrompue ("Univers Genèse"), rendant l'extraction de données (Scraping JSON ou Capture d'écran/OCR) totalement inutilisable pour les attaquants, sans jamais impacter l'expérience d'un vrai visiteur humain.

> **La Philosophie : Le chasseur est devenu la proie.**  
> Plutôt que de dire "Accès Refusé" à un bot intelligent, nous lui disons "Accès Autorisé" et nous lui fournissons des données empoisonnées, traçables, et des interfaces brouillées pour l'Intelligence Artificielle (OCR).

---

## 🤖 Options Rapides pour Développeurs

Si vous êtes un développeur et que vous souhaitez intégrer le SDK Prisme dans votre propre application Express à l'aide d'une IA (ChatGPT, Claude, Gemini, etc.), **copiez simplement le bloc ci-dessous et envoyez-le à votre IA :**

<details open>
<summary><b>📋 PROMPT D'INTÉGRATION POUR IA (Cliquez pour copier)</b></summary>

```text
Agis en tant qu'Ingénieur DevSecOps expert en Node.js.
Je souhaite intégrer le SDK "Prisme Antibot" dans mon application Express.js existante.

Voici l'architecture du SDK Prisme que j'ai récupéré :
Le dossier du SDK s'appelle `prism-sdk/`. Il expose principalement un middleware Express `PrismeShield` et des utilitaires de réfraction des données.

TÂCHE : Écris-moi le code pour intégrer ce SDK dans mon `server.js` (ou `app.js`) en respectant strictement les étapes suivantes :

1. IMPORTS REQUIS :
Importe `express`, `cookie-parser`, `helmet`, `express-rate-limit`.
Importe le SDK : `const { PrismeShield, refract, currentEpoch, honeypot } = require('./prism-sdk');`

2. MIDDLEWARES DE BASE (Avant Prisme) :
- Ajoute `app.set('trust proxy', 1);` si on est derrière Cloudflare/Render.
- Ajoute Helmet pour la sécurité (CSP).
- Ajoute Rate-Limit (ex: 60 req/min).
- Ajoute `cookie-parser()`.
- Ajoute `express.json()`.

3. INITIALISATION DU BOUCLIER PRISME :
Applique le middleware globalement sur TOUTE l'application :
```javascript
app.use(PrismeShield({
    adminToken: process.env.ADMIN_TOKEN || 'votre-token-secret',
    secretKey: process.env.SECRET_KEY || 'cle-secrete-32-octets-min',
    challengeDifficulty: 4,
    zeroBotMode: true // Bloque immédiatement les bots critiques
}));
```

4. PROTECTION D'UNE ROUTE API (Exemple) :
Crée une route `GET /api/data`. 
La doctrine Prisme exige que les données brutes ne soient JAMAIS envoyées aux clients. Elles doivent passer par la fonction `refract()`.
Crée une "POLICY" pour réfracter les données :
```javascript
const DATA_POLICY = {
    id: 'actionable', // Ne change pas
    name: 'cosmetic', // Ajoute un filigrane invisible
    price: 'actionable', 
    views: 'aggregate' // Fausse la donnée (Poison)
};
```
Dans la route `/api/data` :
- Récupère le `sessionSeed` via `req.visitor?.prisme?.sessionSeed`.
- Récupère la réalité via `req.visitor?.prisme?.reality`.
- Utilise `const safeData = refract(rawData, DATA_POLICY, seed, currentEpoch());`
- Si la réalité est `watermarked` ou `decoy`, ajoute un piège : `const payload = honeypot.injectHoneypot(safeData, seed);`
- Renvoie `payload` (ou `safeData` si normal).

Fournis-moi le code complet et commenté de ce `server.js`.
```
</details>

---

## 🛡️ Fonctionnalités Clés

### 1. Preuve de Travail (Proof-of-Work) Incontournable
Avant même d'accéder au site, le visiteur passe par la "Gateway". Son navigateur doit résoudre un défi cryptographique en arrière-plan (`Argon2id`). Cela rend les attaques DDoS L7 et le scraping de masse économiquement non rentables (brûle le CPU du bot).

### 2. Le Moteur Causal (Biométrie & Hardware)
Prisme ne regarde pas seulement l'adresse IP. Il vérifie la **causalité** des signaux :
- **Cohérence Matérielle** : L'OS déclaré correspond-il à la carte graphique (WebGL Renderer) détectée ? Le navigateur déclare-t-il être mobile mais possède un curseur de précision (souris) ?
- **Biométrie Comportementale** : Analyse des courbes de Bézier de la souris, des temps de vol entre les touches du clavier, et détection des injections d'événements synthétiques (DevTools Protocol / Puppeteer).

### 3. L'Univers Genèse (Poisoning des données)
Si un bot est trop intelligent pour être bloqué de front (ex: "Click-farm" humain transférant la session à un script), Prisme bascule la session dans une réalité `watermarked` (filigranée, traçable) ou `decoy` (leurre, agrégats fortement empoisonnés).
- Les champs `aggregate` (stats, compteurs) sont décalés proportionnellement à leur grandeur — invisible comme bruit, mais fausse toute moyenne. Le poison est déterministe par (item, époque) : la moyenne inter-sessions ne l'annule pas.
- Les champs `cosmetic` (descriptions) reçoivent un filigrane par session — si les données fuitent, on retrouve la session source.
- Les champs `actionable` (prix, SKU) restent **exacts** : la doctrine trace/empoisonne les agrégats, elle ne ment pas sur les valeurs contractuelles.

### 4. Brouillage OCR & DRM Anti-Screenshot (Protection Ultime)
Prisme intègre une protection complète contre les captures d'écran, qu'elles soient réalisées par un humain ou par un bot (ex: pour lire le site avec GPT-4V ou un OCR) :
- **Voile de chargement & éjection (Bots) :** Un écran opaque masque le contenu dès le chargement ; il ne se lève qu'au premier geste humain (souris, scroll, toucher, clavier), avec un repli automatique à 3 s. Un bot qui échoue la validation `Zero Bot Mode` (403 / Mur de Fer) est **instantanément redirigé vers Google** — il ne capture rien d'exploitable.
- **Brouillage SVG (Bots suspects) :** Si un bot passe inaperçu mais est dégradé (`watermarked` ou `decoy`), le Frontend applique un filtre SVG de distorsion (déplacement de sous-pixels). L'interface reste esthétique pour un humain (Glassmorphism), mais une IA/OCR lira des lettres disloquées et des chiffres faux.
- **DRM Anti-Capture (Humains) :** Le code intègre une écoute active des raccourcis claviers (Imprim-Écran, Windows+Shift+S, Cmd+Shift+4) et de l'outil d'impression (Ctrl+P). Si un humain tente une capture, l'écran devient instantanément noir et l'utilisateur est redirigé vers Google. De plus, la page disparaît si le navigateur perd le focus.

### 5. Révélation Progressive des Données (Anti-Extraction JSON)
Le prix et les données sensibles ne sont **jamais transmis en entier dans le JSON**. La valeur est fragmentée sur deux canaux :
- **Canal JSON** : la partie entière du prix (`49`)
- **Canal CSS** : les centièmes dans une variable CSS (`--pr-price-0: 99` → `0.99`)

Un script Python qui lit le JSON obtient `49`, pas `49.99`. Seul un navigateur qui exécute le CSS et utilise l'assembleur client (`assembler.js`) reconstitue le prix exact. Voir `prism-sdk/src/server/revelation.js` et `fragmentField()`.

### 6. Pièges HTML Multi-Couches (Frontend Honeypots)
La page visible contient 4 pièges invisibles pour les humains, mais actionnables par les bots :
- **Injection de prompt LLM** : texte invisible ciblant les IA qui lisent le DOM (`GPT-4V`, `Claude`...)
- **Lien fantôme** : `<a>` hors écran (`left: -9999px`) cliqué automatiquement par les crawlers
- **Formulaire autofill** : faux formulaire de connexion rempli automatiquement par les credential stuffers
- **Bouton ghost 6×6 px** : pixel quasi-invisible en coin supérieur gauche, capté par les robots de clic aléatoire

Tout clic sur `/api/feedback-invisible` est tracé et marque la session comme hostile.

---

## ⚙️ Architecture du Projet

```text
antibotsite/
├── prism-sdk/                  # Le SDK du Moteur Prisme (Le Cœur)
│   ├── package.json            # main → src/server/index.js
│   └── src/
│       ├── server/             # Moteur : engine/ (7 couches), refractor, honeypot, PrismeShield
│       └── client/             # Script navigateur (collecte biométrique, PoW solver)
├── src/                        # Votre Application Web
│   ├── server.js               # Serveur Express (Intégration du SDK)
│   ├── config/                 # Configuration globale (Clés secrètes)
│   ├── routes/                 # Vos routes API (Utilisant le Refractor de Prisme)
│   └── views/                  # Interface Front-end (Gateway, Landing, Admin)
└── public/                     # Fichiers statiques (argon2.js, CSS)
```

## 🚀 Lancement Rapide en Local

1. Installez les dépendances :
```bash
npm install
cd prism-sdk && npm install && cd ..
```

2. Démarrez le serveur de développement :
```bash
npm run dev
```

3. Ouvrez `http://localhost:3000` dans votre navigateur.
Vous passerez par la Gateway de vérification, puis accèderez à l'application protégée.

## 📊 Dashboard Administrateur

Le projet inclut un tableau de bord ultra-moderne pour monitorer les attaques en temps réel.
- URL : `http://localhost:3000/admin`
- Le mot de passe (ADMIN_TOKEN) est généré aléatoirement au démarrage et affiché dans les logs de votre console si vous ne l'avez pas défini dans vos variables d'environnement.

---

*Conçu pour rendre l'automatisation hostile et économiquement ruineuse.*
