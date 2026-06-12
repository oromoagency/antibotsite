# Audit d'alignement NexAPI Antibot

Date: 2026-06-12

Depot audite:

- Local: `C:\Users\sanog\.gemini\antigravity\scratch\antibotsite`
- Remote Git: `https://github.com/oromoagency/antibotsite.git`
- Page GitHub publique: inaccessible depuis l'environnement d'audit (`404 Not Found`)

## Verdict court

Le projet n'est pas encore aligne avec la doctrine Prisme Causal / Zero Bot.

Il contient beaucoup de bonnes briques, mais elles sont actuellement mal raccordees:

- ancien pipeline a score dans `src/layers/*`;
- nouveau pipeline Prisme Causal dans `src/antibot/*`;
- ancien tracking visiteurs via `_nx_session`;
- nouveau token opaque via `nx_sess`;
- ancien token chiffre via `human_auth_token`;
- gate humain present, mais non active sur les pages;
- tests historiques presents, mais `npm test` ne les lance pas et plusieurs echouent.

Le risque principal: le systeme donne l'impression d'etre en Zero Bot Mode, mais le contenu public reste servi sans session humaine validee.

---

## 1. Reponse sur les APIs externes

### Est-ce qu'il faut des APIs externes?

Pour le coeur de Prisme Causal: non.

Le coeur doit rester local:

- session opaque;
- gate humain;
- faits de requete;
- contradictions;
- coherence causale;
- protection API;
- Prisme watermarked/degraded;
- logs.

Mais pour une production serieuse, certaines sources externes ou semi-externes sont utiles.

### APIs ou donnees externes recommandees

#### 1. Reputation IP / ASN / Datacenter / VPN

Utile pour enrichir L2.

Recommandation:

- preferer une base locale type MaxMind GeoIP2 / GeoLite2 ou IPinfo DB;
- eviter de dependre en temps reel d'une API gratuite sur chaque visite.

Etat actuel:

- `src/store/visitors.js` appelle deja `https://ip-api.com/json/...`;
- ce lookup nourrit surtout l'ancien store visiteur;
- le nouveau pipeline `src/antibot/*` n'en profite pas vraiment.

Conclusion:

Il faut soit integrer proprement l'ASN/reputation au nouveau `networkCollector`, soit retirer cette dependance de la decision securite.

#### 2. JA4 / TLS fingerprint

Tres utile, mais l'application Express ne peut pas le deviner seule si TLS est termine par Render/Cloudflare.

Recommandation:

- faire produire JA4 par le reverse proxy, CDN, WAF ou edge;
- transmettre au backend via header interne signe ou controle.

Etat actuel:

- l'ancien `L1_tls` sait lire `x-ja4`;
- le nouveau `src/antibot/*` ne l'exploite pas encore.

#### 3. Verification DNS Googlebot/Bingbot

En Zero Bot Mode, ce n'est pas necessaire pour autoriser, puisque tous les bots sont refuses.

Mais c'est utile pour classifier:

- `verified_search_crawler` -> refus sobre;
- `crawler_spoof_suspect` -> contradiction forte.

Conclusion:

Pas obligatoire pour le MVP Zero Bot. Utile plus tard pour les logs et l'analyse.

#### 4. Alerting externe

Telegram est utile mais optionnel.

Etat actuel:

- `src/controllers/telegramController.js` utilise `https://api.telegram.org/...`;
- si les variables d'environnement manquent, les notifications sont desactivees.

Conclusion:

OK comme observabilite optionnelle, pas comme dependance critique.

### APIs externes a eviter dans le chemin critique

Eviter que chaque requete depende de:

- API gratuite sans SLA;
- reputation IP distante lente;
- verification DNS synchrone;
- services tiers qui peuvent tomber ou limiter.

Regle:

> Si une API externe tombe, le site doit rester utilisable et securise en mode degrade.

---

## 2. Findings critiques

### P0 - Le middleware Prisme Causal plante sur une session neuve

Fichier:

- `src/antibot/middleware/collectRequestFacts.js`

Constat:

`collectRequestFacts` lit `req.visitor.facts.length`, mais le modele de session cree les facts dans `req.visitor.coherence.facts`.

Evidence:

- `sessionModel.js` cree `coherence.facts`;
- `collectRequestFacts.js` lit `visitor.facts`;
- test manuel Node: `TypeError: Cannot read properties of undefined (reading 'length')`.

Impact:

La premiere requete peut tomber avant meme d'atteindre `/`, `/api/challenge-config` ou le gate.

Correction recommandee:

- choisir une seule source: `session.facts` ou `session.coherence.facts`;
- mettre a jour tous les collectors, rules et coherenceGraph;
- ajouter un test de middleware sur session neuve.

### P0 - Le gate humain est desactive sur les pages

Fichier:

- `src/routes/web.js`

Constat:

`requireHuman` existe, mais `router.use(requireHuman)` est commente.

Impact:

Les pages publiques reelles sont servies directement:

- `/`;
- `/login`;
- `/register`;
- `/docs`;
- `/pricing`;
- `/app`.

Cela contredit la doctrine Zero Bot:

> Pas de session humaine validee, pas de contenu utile.

Correction recommandee:

- activer le gate pour les routes utiles;
- exclure seulement les assets, `/gateway`, `/robots.txt`, healthcheck minimal, et admin si voulu;
- s'assurer que le gate ne cree pas de boucle.

### P0 - Zero Bot laisse `unknown` en realite normale

Fichier:

- `src/antibot/policy/causalOrchestrator.js`

Constat:

Quand `coherence.level === "unknown"`, la decision est `normal`.

Impact:

Une session non prouvee peut recevoir la realite normale.

Correction recommandee:

En Zero Bot Mode:

- `unknown` ne doit pas devenir `normal`;
- il doit devenir `gate_required`, `challenge_light`, `observed`, ou `blocked` selon le type de route;
- l'acces au contenu utile doit dependre de `humanValidated === true`, pas seulement de l'absence de contradiction.

### P0 - Les routes demo sensibles restent publiques

Fichier:

- `src/routes/api.js`

Constat:

`requireHumanApi` laisse passer:

- `/api/prism/demo`;
- `/api/demo/*`;
- `/api/__internal/*`.

Ensuite `/api/prism/demo` renvoie des donnees exactes si `reality` vaut `normal` ou `observed`.

Impact:

Dans l'etat actuel, une session nouvelle ou unknown peut appeler la demo et recevoir les donnees brutes, surtout parce que l'orchestrateur retourne `normal` pour `unknown`.

Correction recommandee:

- en Zero Bot Mode, aucune API utile ne doit etre publique;
- les endpoints demo doivent etre soit purement leurres, soit exiger session humaine;
- ne jamais renvoyer de dataset reel complet a une session non validee.

---

## 3. Findings majeurs

### P1 - Trois systemes de session coexistent

Fichiers:

- `src/antibot/session/tokenService.js`
- `src/middlewares/visitorTracker.js`
- `src/layers/L7_session.js`
- `src/views/*.html`

Constat:

Le projet utilise en parallele:

- `nx_sess`: nouveau token opaque;
- `_nx_session`: ancien tracking visiteur lisible par JS;
- `human_auth_token`: ancien token chiffre contenant suspicion/seed.

Impact:

- le frontend lit `_nx_session`;
- le nouveau middleware pose `nx_sess`;
- l'ancien visitorTracker n'est pas branche dans `server.js`;
- certains controllers continuent a lire `_nx_session`;
- `prismAdapter` continue a lire `human_auth_token`.

Correction recommandee:

Unifier la session:

- garder `nx_sess` comme session securite opaque;
- creer un identifiant public separe si le JS doit tracker des events;
- retirer progressivement `human_auth_token`;
- adapter les vues pour ne plus dependre de `_nx_session` comme source de securite.

### P1 - L'ancien pipeline L1/L2 est desactive dans `server.js`

Fichier:

- `src/server.js`

Constat:

Les middlewares `L1_network.analyze` et `L2_access.middleware` sont commentes.

Impact:

Les tests historiques valident L1/L2, mais ces couches ne protegent pas les requetes normales dans le serveur actuel.

Correction recommandee:

- soit brancher L1/L2 dans le nouveau pipeline sous forme de collectors/facts;
- soit supprimer la confusion et migrer clairement vers `src/antibot/*`;
- ne pas garder des tests qui valident un chemin non execute.

### P1 - Admin API probablement bloquee par le gate API

Fichier:

- `src/routes/api.js`

Constat:

`router.use(requireHumanApi)` est place avant les endpoints admin.

Impact:

Les appels `/api/admin/stats`, `/api/admin/visitors`, `/api/admin/logs` exigent `humanValidated`, meme si le dashboard admin utilise deja `x-admin-token`.

Comme `/admin` est exclu du gate HTML, l'admin peut charger la page mais recevoir `401 human_session_required` sur les APIs.

Correction recommandee:

- definir une politique admin explicite;
- soit admin exige token + gate humain;
- soit admin exige token seul;
- mais ne pas laisser un demi-etat ou la page marche et les APIs echouent.

### P1 - `SECRET_KEY` est modifiee par un suffixe de test

Fichier:

- `src/config/index.js`

Constat:

`SECRET_KEY += '_mur_de_fer_test_1'`

Impact:

Cela invalide volontairement les cookies et introduit une logique de test en production.

Correction recommandee:

- retirer ce suffixe;
- versionner les cookies proprement si une invalidation est necessaire;
- utiliser `SESSION_SECRET_VERSION` ou rotation de cle.

### P1 - Les tests historiques echouent

Commande:

```txt
Get-ChildItem tests/*.js | node
```

Resultat:

Tests en echec:

- `load_profile_test.js`
- `phase1_check.js`
- `phase5_check.js`
- `phase6_check.js`
- `phase7_check.js`
- `phase8_check.js`
- `phase9_check.js`
- `phase11_check.js`

Tests passes:

- `phase2_check.js`
- `phase3_check.js`
- `phase4_check.js`
- `phase10_check.js`

Autre probleme:

- `npm test` echoue volontairement avec `Error: no test specified`.

Correction recommandee:

- creer un vrai script `npm test`;
- separer tests legacy score et tests Prisme Causal;
- ajouter tests MVP: session opaque, gate, API requires human, contradictions, watermark.

---

## 4. Findings moyens

### P2 - Encodage casse dans plusieurs fichiers

Constat:

README et certains commentaires affichent des caracteres corrompus:

- `systÃ¨me`;
- `rÃ©alitÃ©`;
- `â€”`;
- etc.

Impact:

Lisibilite degradee, risque de confusion dans docs et dashboard.

Correction recommandee:

- normaliser en UTF-8;
- ou convertir en ASCII propre si l'objectif est d'eviter les caracteres accentues.

### P2 - Cookie `nx_sess` force `secure: true`

Fichier:

- `src/antibot/session/tokenService.js`

Impact possible:

En local HTTP, selon navigateur/environnement, le cookie peut ne pas etre pose ou renvoye correctement.

Correction recommandee:

```js
secure: process.env.NODE_ENV === 'production'
```

### P2 - Le README decrit encore l'ancien modele a score

Constat:

Le README parle encore de:

- score 100;
- lanes `rich/accessibile/trap`;
- JWT/AES;
- poisoning central.

Impact:

La documentation publique ne correspond pas a Prisme Causal / Zero Bot.

Correction recommandee:

- mettre le README au niveau des nouveaux docs;
- expliquer la migration;
- indiquer clairement ce qui est implemente, experimental, ou legacy.

---

## 5. Alignement avec Prisme Causal

| Exigence | Etat | Commentaire |
|---|---|---|
| Token opaque | Partiel | `nx_sess` existe, mais ancien `human_auth_token` reste utilise |
| Session serveur | Partiel | Store RAM existe, bug facts bloque le runtime |
| Gate humain | Non aligne | Code present mais desactive |
| Zero Bot pages | Non aligne | Pages reelles servies sans validation |
| Zero Bot APIs | Partiel | Certaines APIs exigeant humain, mais demo publiques |
| Graphe de coherence | Partiel | Rules simples, pas encore vrai graphe causal |
| Contradictions | Partiel | 3 regles MVP seulement |
| Orchestrateur sans score | Partiel | Nouveau orchestrateur existe, mais legacy score encore central |
| Prisme watermarked | Partiel | Demo refract, mais pas politique robuste |
| Prisme decoy | Experimental | Honeypot present, mais route publique discutable |
| Faux positifs | Faible | Tests historiques echouent, pas de tests Zero Bot accessibilite |
| Observabilite | Partiel | Telegram/logs anciens, pas dashboard Prisme Causal unifie |

---

## 6. Priorites de correction

### Priorite 1 - Rendre le serveur stable

1. Corriger `session.facts` vs `session.coherence.facts`.
2. Ajouter un test middleware session neuve.
3. Faire passer `/api/challenge-config` et `/` sans crash.

### Priorite 2 - Activer le vrai Zero Bot

1. Activer `requireHuman` sur les pages utiles.
2. Creer une route `/gateway` explicite si necessaire.
3. Interdire le contenu utile sans `humanValidated`.
4. Fermer les APIs demo ou les transformer en vrais leurres non critiques.

### Priorite 3 - Unifier les sessions

1. Choisir `nx_sess` comme source de verite securite.
2. Retirer ou isoler `_nx_session`.
3. Retirer `human_auth_token` du chemin critique.
4. Adapter frontend tracking au nouveau modele.

### Priorite 4 - Integrer L1/L2 au nouveau pipeline

1. Transformer L1/L2 en facts/contradictions.
2. Utiliser ASN/reputation dans `networkCollector`.
3. Arreter de compter sur des couches legacy non branchees.

### Priorite 5 - Tests et rollout

1. Ajouter `npm test`.
2. Ajouter tests Zero Bot:
   - page utile sans session -> gateway;
   - API utile sans session -> 401;
   - session validee -> acces;
   - bot UA -> refus;
   - unknown -> pas de realite normale sur contenu utile.
3. Garder anciens tests seulement s'ils correspondent encore a la doctrine.

---

## 7. Conclusion

Le projet est une bonne base, mais il n'est pas encore aligne.

Le plus important n'est pas d'ajouter plus d'APIs externes.

Le plus important est de finir le socle:

> une seule session, un gate actif, aucune donnee utile sans validation humaine, et des contradictions qui pilotent Prisme.

Ensuite seulement, les APIs externes de reputation IP/ASN ou JA4 deviennent utiles pour enrichir le moteur.

