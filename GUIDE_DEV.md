# Guide du Développeur - Prisme Antibot

Bienvenue dans le guide de développement officiel de **Prisme Antibot**. Ce document est destiné aux développeurs qui souhaitent intégrer, modifier ou étendre le SDK Prisme dans leur propre infrastructure.

---

## 1. Architecture Globale

Prisme n'est pas un simple captcha. C'est un moteur de **cybersécurité comportementale et causale** fonctionnant en 7 couches. Il est divisé en deux parties :

1. **Le Backend (Node.js/Express) :** Le SDK Prisme (middleware `PrismeShield` et `refract()`).
2. **Le Frontend (JavaScript/HTML) :** La Gateway (page de vérification de sécurité) et les défenses anti-screenshot (OCR Jamming, Overlay).

### Flux d'une requête

1. Un visiteur tente d'accéder à l'application.
2. Si sa requête vise une page protégée, `PrismeShield` vérifie son token JWT (`human_auth_token`).
3. **S'il n'a pas de token**, il est redirigé vers la **Gateway** (`/api/noscript-entry` si pas de JS, ou `gateway.html`).
4. Sur la Gateway, le navigateur résout un défi cryptographique (Argon2id) et le script frontend capture la biométrie (souris, clavier) et le profil matériel (GPU, WebGL).
5. Les résultats sont envoyés à `/api/verify-challenge`.
6. Prisme analyse toutes les données (L1 à L7), calcule un score de contradiction, assigne une **Réalité** (`normal`, `watermarked`, `poisoned`, `blocked`), et émet un cookie sécurisé.
7. Le visiteur navigue. Vos routes API utilisent la fonction `refract()` pour modifier les données renvoyées en fonction de sa Réalité.

---

## 2. Intégration du SDK (Backend)

### A. Initialiser le Middleware

Dans votre `server.js` :

```javascript
const express = require('express');
const cookieParser = require('cookie-parser');
const { PrismeShield, refract, currentEpoch, honeypot } = require('./prism-sdk');

const app = express();

app.use(express.json());
app.use(cookieParser());
app.set('trust proxy', 1); // Indispensable si vous êtes derrière un reverse-proxy (Cloudflare, Render)

// Activation de Prisme
app.use(PrismeShield({
    adminToken: process.env.ADMIN_TOKEN, // Mot de passe du Dashboard
    secretKey: process.env.SECRET_KEY,   // Clé de chiffrement des tokens JWT
    challengeDifficulty: 4,              // Difficulté cryptographique (Argon2)
    zeroBotMode: true                    // true = Bloque les bots critiques 403. false = Empoisonne tous les bots.
}));
```

### B. Protéger vos Routes API (Réfraction des Données)

Le cœur de Prisme est "l'Univers Genèse" : la capacité d'empoisonner les scrapers silencieusement.

```javascript
// Vos données brutes
const data = [
    { id: '1', nom: 'Produit A', prix: 100, vues: 45000 },
    { id: '2', nom: 'Produit B', prix: 200, vues: 12000 }
];

// Politique de réfraction
const DATA_POLICY = {
    id:   'actionable', // Intouchable (Logique métier)
    prix: 'actionable', // Intouchable (Logique métier)
    nom:  'cosmetic',   // Remplacé par des synonymes liés à l'ID de la session
    vues: 'aggregate'   // Aliéné mathématiquement (Brouillage par Epoch)
};

app.get('/api/produits', (req, res) => {
    // Si req.visitor n'existe pas, bloquez.
    if (!req.visitor || !req.visitor.prisme) return res.status(401).send("Unauthorized");

    const seed = req.visitor.prisme.sessionSeed;
    const reality = req.visitor.prisme.reality;

    // 1. Réfracter les données
    const safeData = refract(data, DATA_POLICY, seed, currentEpoch());

    // 2. Pièges Honeypot
    if (reality === 'watermarked' || reality === 'poisoned') {
        // Ajoute de faux attributs irrésistibles pour un bot
        return res.json(honeypot.injectHoneypot(safeData, seed));
    }

    res.json(safeData);
});
```

---

## 3. Intégration Frontend (Cybersécurité Visuelle)

### A. La Gateway (`gateway.html`)

La Gateway doit être servie publiquement. Elle contient le code `argon2.min.js` et le script de profilage hardware. Si vous utilisez l'application modèle, vous n'avez rien à changer à `gateway.html`. 

Si vous intégrez le code dans un Framework (React, Vue) :
- Exécutez le minage Argon2id dans un Web Worker.
- Collectez la biométrie (`mousemove`, `keydown`) en arrière-plan pendant au moins 2 secondes avant l'envoi de la payload.

### B. Le Brouillage OCR (Bots Suspects)
Pour empêcher GPT-4V, Google Lens ou un algorithme OCR de lire votre site via une capture d'écran, utilisez un filtre SVG de Distorsion.
1. Ajoutez ce bloc SVG en haut de votre `<body>` :
```html
<svg width="0" height="0" style="position:absolute;z-index:-1;">
    <defs>
        <filter id="ocr-scramble">
            <feTurbulence type="turbulence" baseFrequency="0.25" numOctaves="1" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
    </defs>
</svg>
```
2. Ajoutez la classe CSS dynamique depuis votre JavaScript :
```css
.ocr-jamming { filter: url(#ocr-scramble); position: relative; }
```
3. Dans votre logique Fetch, activez le filtre si la session est suspecte :
```javascript
if (json.reality === 'watermarked' || json.reality === 'poisoned') {
    document.getElementById('sensible-data-container').classList.add('ocr-jamming');
}
```

### C. Le Blackout UI (Zero Bot Mode)
Pour empêcher formellement les bots bloqués de voir la page, la Gateway ne lève le voile noir de chargement que si le défi est validé. Si l'API retourne une erreur 403 (Zero Bot Mode) :
```javascript
const data = await res.json();
if (!data.success) {
    // Le voile ne se lève jamais, on affiche un message pénalisant
    document.body.innerHTML = '<div style="background:#000;color:#f00;height:100vh;">ACCESS DENIED</div>';
}
```

### D. DRM Anti-Screenshot (Protection contre le vol manuel)
Pour bloquer les voleurs humains qui utilisent les raccourcis de capture d'écran, ajoutez ce script auto-exécutable à la fin de votre `<body>` :
```html
<script>
(function() {
    // 1. Bloquer l'impression (Ctrl+P / Cmd+P)
    window.addEventListener('beforeprint', () => {
        document.body.style.display = 'none';
        window.location.href = 'https://www.google.com';
    });

    // 2. Détection des raccourcis clavier
    document.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isPrintScreen = e.key === 'PrintScreen' || e.keyCode === 44;
        const isWinSnip = e.metaKey && e.shiftKey && (e.key === 's' || e.key === 'S');
        const isMacSnip = isMac && e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5');
        const isPrintShortcut = (e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P');

        if (isPrintScreen || isWinSnip || isMacSnip || isPrintShortcut) {
            e.preventDefault();
            document.body.innerHTML = '<div style="background:#000;height:100vh;width:100vw;"></div>';
            window.location.href = 'https://www.google.com';
        }
    });

    // 3. Dissimulation lors de la perte de focus (ouverture de l'outil OS de capture)
    window.addEventListener('blur', () => { document.body.style.opacity = '0'; });
    window.addEventListener('focus', () => { document.body.style.opacity = '1'; });
    
    // 4. Bloquer le clic droit
    document.addEventListener('contextmenu', e => e.preventDefault());
})();
</script>
```

---

## 4. Fonctionnement du Moteur Causal (Les 7 Couches)

Prisme ne se limite pas aux headers HTTP. Il analyse les contradictions entre les couches.

- **L1 (Réseau & TLS) :** L'Empreinte TLS `JA4` correspond-elle au navigateur déclaré (User-Agent) ?
- **L2 (Réputation IP) :** L'IP appartient-elle à un datacenter (AWS, OVH, DigitalOcean) ? Est-ce un nœud Tor ?
- **L3 (Proof-of-Work) :** Délai de minage Argon2id.
- **L4 (Hardware) :** Un navigateur "Mobile" qui possède le profil `pointer: fine` (une souris) est une contradiction flagrante. Un `WebGL Renderer` de type `SwiftShader` indique un Chrome Headless.
- **L5 (Automatisation) :** Détection de variables Puppeteer (`navigator.webdriver`), pièges CDP (Chrome DevTools Protocol).
- **L6 (Biométrie) :** Pression de clic nulle (`pressure: 0`), Mouvements linéaires parfaits, Temps de frappe (Dwell Time) constants. De plus, la règle critique `synthetic_biometrics` bloque instantanément les courbes générées algorithmiquement (ex: `ghost-cursor`) ou les trajectoires mathématiquement lisses.
- **L7 (Session) :** Persistance JWT et suivi des rebonds.

Si le moteur trouve une contradiction grave (ex: L5 Automatisé), la réalité devient **blocked**. Si les contradictions sont légères (IP suspecte + pas de souris), la session devient **watermarked**.

---

## 5. Comment Personnaliser la Tolérance ?

Dans le code source du SDK (`prism-sdk/src/server/engine/`), les règles de contradiction dictent les pénalités. Vous pouvez modifier la rigidité du `Zero Bot Mode`.
Par défaut : 
- 1 Fait `CRITICAL` = Blocage (403).
- 2 Faits `HIGH` = Blocage (403).
- Sinon = Empoisonnement (200 OK avec fausses données).

---

## 6. Le Dashboard Admin

Le Dashboard (accessible via `/admin`) est un outil clé. Il interroge :
- `/api/admin/stats` : Vue globale.
- `/api/admin/visitors` : Liste des visiteurs actifs et leur matrice d'empreinte.
- `/api/admin/logs` : Journaux détaillés des contradictions détectées.

Pour accéder à ces routes, passez `x-admin-token` dans les headers de votre requête HTTP, ou connectez-vous manuellement via l'interface `/admin`.

---

*Développé pour la furtivité et l'aliénation des fermes de bots.*
