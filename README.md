# Double Input Tracker

Suivez les **doubles inputs** (chatter) et les **appuis manqués** des switchs de votre clavier mécanique,
et découvrez si le problème vient du switch lui-même ou de son emplacement.

**👉 [armellarcier.github.io/double-input-tracker](https://armellarcier.github.io/double-input-tracker/)**

Application web gratuite, sans serveur ni compte à créer : vos données sont enregistrées dans **votre
Google Drive**. Pensée pour le mobile, elle fonctionne aussi sur ordinateur.

![Logo](logo-120.png)

---

## Pour les utilisateurs

### Démarrer

1. Ouvrez l'application et connectez-vous avec Google.
2. Créez un clavier : un nom, un format (60 %, 65 %, 75 %, TKL, 100 %) et une disposition
   (AZERTY ISO, QWERTY ISO UK, QWERTY ANSI US).
3. Sur mobile, ajoutez-la à l'écran d'accueil pour l'ouvrir comme une appli.

### Au quotidien

| Je veux…                         | Je fais…                                                                 |
|----------------------------------|--------------------------------------------------------------------------|
| Noter un double input            | Je touche la touche, puis **⚡ Double input**                            |
| Noter un appui non enregistré    | Je touche la touche, puis **⊘ Appui manqué**                             |
| Le faire depuis mon ordinateur   | J'appuie directement sur la touche physique : elle s'ouvre dans l'appli |
| Indiquer que j'ai inversé deux switchs | Touche → **⇄ Inverser avec…** → je touche l'autre touche          |
| Indiquer un switch remplacé par un neuf | Touche → **♻ Switch neuf** (son compteur repart de zéro)        |
| Corriger une erreur              | **Annuler** dans la notification, ou ✕ dans l'historique                 |

### Lire les résultats

Les onglets **⚡ Doubles inputs** / **⊘ Appuis manqués** choisissent le symptôme affiché : coloration,
statistiques, classement et analyse sont calculés séparément pour chacun. L'historique les montre tous.

- **Coloration par position** : incidents survenus à chaque emplacement, quel que soit le switch.
- **Coloration par switch** : incidents du switch actuellement installé, où qu'il ait été avant.
- **Classement** : les switchs les plus touchés et la part du clavier concernée.
- **Analyse des inversions** : pour chaque switch déplacé et chaque position ayant changé de switch,
  le nombre d'incidents, la durée et le taux par semaine.
  - **« suit le switch »** → le switch est probablement défectueux.
  - Pour un appui manqué, pensez aussi à un switch mal enfoncé dans son socket ou à un stabilisateur qui accroche.
  - **« suit la position »** → regardez plutôt la soudure, le socket hotswap, le PCB ou le debounce du firmware.
  - Une durée courte n'est pas encore significative : comparez les taux par semaine.

### Vos données

- Elles sont stockées dans un fichier `double-input-tracker.json` de votre Google Drive. L'application
  n'a accès **qu'aux fichiers qu'elle a créés** (permission `drive.file`).
- Une copie locale permet de continuer à saisir hors connexion ou quand la session Google a expiré
  (au bout d'une heure) ; tout est envoyé à la reconnexion.
- Vous pouvez utiliser plusieurs appareils : les données sont fusionnées, rien n'est écrasé.
- Export JSON depuis le menu du compte. Détails : [règles de confidentialité](https://armellarcier.github.io/double-input-tracker/privacy.html)
  · [conditions d'utilisation](https://armellarcier.github.io/double-input-tracker/terms.html).

---

## Pour les développeurs

### Stack

HTML, CSS et JavaScript vanilla : aucune dépendance, aucun build. Seul script externe :
[Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
pour obtenir un jeton OAuth (modèle « token », sans backend). Les appels à l'API Drive v3 se font avec `fetch`.

```
index.html          structure de la page et dialogues
app.js              état, rendu, actions, authentification et synchro Drive
layouts.js          définitions des claviers et libellés par disposition
config.js           Client ID OAuth et nom du fichier Drive
style.css           styles (clair / sombre via prefers-color-scheme)
privacy.html, terms.html
```

### Modèle de données

Le fichier Drive (et le cache `localStorage`) contient deux collections d'enregistrements, chacun
avec un `id` et une date de modification `u` :

```jsonc
{
  "v": 1,
  "keyboards": { "<id>": { "id", "name", "size", "variant", "createdAt", "u", "deleted?" } },
  "events": {
    "<id>": { "id", "kb", "ts", "u", "deleted?", "type": "double" | "skip", "key": "KeyQ" }
    //        type "swap"    → "a", "b"  (deux positions)
    //        type "replace" → "key"
  }
}
```

- **Types d'incidents** : déclarés dans `KINDS` (`app.js`) ; en ajouter un suffit à créer son onglet,
  son bouton et ses statistiques.
- **Les positions sont des `KeyboardEvent.code`**, ce qui permet de sélectionner une touche en appuyant dessus.
- **L'emplacement des switchs n'est pas stocké** : il est recalculé en rejouant les événements par ordre
  chronologique (`computeState` dans `app.js`). Au départ, chaque switch porte l'identifiant de sa
  position d'origine ; un switch neuf reçoit `new:<id de l'événement>`.
- **Synchro** : téléchargement du fichier distant, fusion enregistrement par enregistrement (le `u` le plus
  récent gagne, les suppressions sont des marqueurs `deleted`), puis envoi si quelque chose a changé.
  Aucune édition n'est perdue entre appareils.

### Ajouter un format de clavier

Les dispositions sont décrites dans `layouts.js` avec une mini-syntaxe par rangée :
`Code` = touche 1u, `Code@1.5` = largeur, `Code^2` = hauteur, `Enter@iso` = Entrée ISO,
`+0.5` = espace horizontal, `|0.5` = espace vertical. Les libellés propres à une langue vont dans `VARIANTS`.

### Lancer en local

```bash
python3 -m http.server 8000
```

Ouvrez <http://localhost:8000>. Sans Client ID valide, l'application fonctionne en local uniquement
(stockage dans le navigateur).

### Déployer votre propre instance

1. Forkez le dépôt et activez GitHub Pages (**Settings → Pages → Deploy from a branch → `main` / root**).
2. Dans [Google Cloud Console](https://console.cloud.google.com/) :
   - activez la **Google Drive API** ;
   - configurez l'écran de consentement OAuth (type Externe, portée `.../auth/drive.file`) ;
   - créez un **ID client OAuth « Application Web »** avec comme origines JavaScript autorisées
     `https://<utilisateur>.github.io` et `http://localhost:8000`. Aucune URI de redirection n'est nécessaire.
3. Remplacez `clientId` dans `config.js` (ce n'est pas un secret).

### Contribuer

Tickets et pull requests bienvenus. Gardez l'esprit du projet : zéro dépendance, zéro build, données
chez l'utilisateur.
