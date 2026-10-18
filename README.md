# Double Input Tracker

Petite appli statique (GitHub Pages) pour suivre les doubles inputs des switchs d'un clavier mécanique.
Les données sont stockées dans **votre Google Drive** (fichier `double-input-tracker.json`), avec une copie
locale sur chaque appareil pour pouvoir saisir même quand la session Google a expiré.

## Fonctionnement

- **Créer un clavier** : nom, format (60 / 65 / 75 / TKL / 100 %) et disposition (AZERTY ISO, QWERTY UK/US).
- **Signaler un double input** : touchez la touche, puis « ⚡ Double input ». Sur ordinateur, vous pouvez
  aussi appuyer directement sur la touche physique pour l'ouvrir.
- **Inverser deux switchs** : touchez la touche → « ⇄ Inverser avec… » → touchez l'autre touche.
  L'appli sait ensuite quel switch est à quelle position, et la suite du suivi est attribuée au bon switch.
- **Switch neuf** : remplace le switch d'une position (son compteur part de zéro).
- **Coloration** « par position » ou « par switch », classement, et analyse des inversions
  (doubles inputs par position/switch, durée, taux par semaine, étiquettes « suit le switch » /
  « suit la position »).
- Chaque action peut être annulée (toast) ou supprimée depuis l'historique.

## Mise en place

### 1. Google Cloud (une seule fois, ~5 min)

1. Ouvrez <https://console.cloud.google.com/> et créez un projet (ex. « double-input-tracker »).
2. **APIs et services → Bibliothèque** : activez **Google Drive API**.
3. **APIs et services → Écran de consentement OAuth** (Google Auth Platform) :
   type **Externe**, renseignez le nom de l'appli et votre e-mail.
   Dans **Audience**, laissez le statut « En test » et ajoutez votre adresse Google comme **utilisateur test**.
   Ajoutez la portée `https://www.googleapis.com/auth/drive.file` (non sensible : l'appli ne voit que
   les fichiers qu'elle a créés).
4. **Identifiants → Créer des identifiants → ID client OAuth** :
   - Type : **Application Web**
   - Origines JavaScript autorisées :
     - `https://armellarcier.github.io`
     - `http://localhost:8000` (pour tester en local)
   - Aucune URI de redirection n'est nécessaire.
5. Copiez l'ID client (`xxxx.apps.googleusercontent.com`) dans `config.js`.
   Ce n'est pas un secret, il peut être commité.

### 2. GitHub Pages

```bash
git init && git add . && git commit -m "Double Input Tracker"
gh repo create double-input-tracker --public --source . --push
```

Puis sur GitHub : **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**.
L'appli sera disponible sur `https://armellarcier.github.io/double-input-tracker/`.

Sur mobile, « Ajouter à l'écran d'accueil » l'installe comme une appli.

### Tester en local

```bash
python3 -m http.server 8000
```

puis ouvrez <http://localhost:8000>.

## Notes

- Une session Google dure 1 h (limite des applis 100 % statiques, sans serveur pour rafraîchir le jeton).
  Au-delà, un bouton « Se reconnecter » apparaît ; la reconnexion est en un clic puisque l'accès est
  déjà accordé. Les saisies faites entre-temps sont gardées localement puis envoyées.
- La synchro fusionne les données du Drive et de l'appareil (rien n'est écrasé si vous saisissez sur
  le téléphone et l'ordinateur).
