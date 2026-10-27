# Double Input Tracker

Appli web statique (GitHub Pages) pour suivre les doubles inputs et appuis manqués des switchs d'un clavier
mécanique. Données dans le Google Drive de l'utilisateur. En ligne : https://armellarcier.github.io/double-input-tracker/

## Règles du projet

- **Zéro dépendance, zéro build.** HTML/CSS/JS vanilla servis tels quels. Pas de npm, pas de bundler, pas de framework.
  Le seul script externe est Google Identity Services (`accounts.google.com/gsi/client`).
- **Interface en français**, mobile d'abord (usage principal : téléphone à côté du clavier).
- **Aucun serveur** : ne rien ajouter qui demande un backend ou un secret. `config.js` ne contient que le Client ID OAuth, qui est public.
- **Permission Google minimale** : uniquement `drive.file`. Ne pas élargir la portée (elle déclencherait une validation Google).
- Style du code : IIFE `'use strict'`, fonctions courtes, rendu par `innerHTML` + `esc()` pour tout texte utilisateur,
  délégation d'événements via `data-act` → objet `actions`.

## Fichiers

- `app.js` : état, rendu, actions, auth GIS, synchro Drive.
- `layouts.js` : formats de clavier (mini-syntaxe documentée en tête de fichier) et libellés par disposition (`VARIANTS`).
  `char()` donne le caractère tapé par une touche (test de frappe).
- `typing.js` : test de frappe, logique pure (génération du texte, alignement saisie/texte, détection) ; l'interface est dans `app.js`.
- `style.css` : tokens de couleur sur `:root`, thème sombre via `prefers-color-scheme`.
- `privacy.html`, `terms.html` : pages exigées par l'écran de consentement OAuth ; à mettre à jour si les données traitées changent.

## Invariants du modèle de données (à respecter absolument)

- Deux collections `keyboards` et `events`, indexées par `id`. Chaque enregistrement a `u` (date de modif).
- **Toute modification d'un enregistrement doit mettre à jour `u`** (passer par `addEvent` / `patch` / `commit`),
  sinon la fusion entre appareils la perdra.
- **Pas de suppression physique** : on pose `deleted: true` (marqueur fusionnable).
- **L'emplacement des switchs n'est jamais stocké** : il se déduit en rejouant les événements (`computeState`).
  Les événements `swap` et `replace` ne doivent donc jamais être réécrits a posteriori.
- Les positions sont des `KeyboardEvent.code` ; changer un code dans `layouts.js` casse l'historique des claviers existants.
- Le format du fichier Drive doit rester rétrocompatible (des données réelles existent déjà).

## Étendre

- Nouveau type d'incident : ajouter une entrée dans `KINDS` (`app.js`) + une couleur dans `style.css`.
- Nouveau format de clavier : ajouter un `case` dans `rowsFor` et une entrée dans `SIZES` (`layouts.js`).

## Tester

```bash
python3 tests/smoke_test.py
```

Test de bout en bout Playwright (Chromium headless), sans Google. Captures dans `tests/out/` (ignoré par git).
Lancer ce test après toute modification de `app.js`, `layouts.js` ou `style.css`, et regarder les captures
pour les changements visuels. La connexion Google et la synchro Drive ne sont pas testables ici : le dire
explicitement plutôt que de les déclarer vérifiées.

Serveur local : `python3 -m http.server 8000` puis http://localhost:8000 (origine autorisée dans le client OAuth).

## Déployer

Un push sur `main` redéploie GitHub Pages (~1 min). Vérifier ensuite avec `curl` que le fichier modifié est servi.
Les utilisateurs peuvent voir l'ancienne version quelques minutes à cause du cache.
