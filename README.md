# P83 Thermal Printer – PWA

Application Progressive Web App pour imprimer des **PDF** sur une imprimante thermique **P83** (Xprinter / LFPERT / BORN4SHIP / etc.) depuis une tablette ou un téléphone Android.

## Fonctionnalités

- Connexion Bluetooth (Web Bluetooth)
- Impression de PDF (page par page ou document entier)
- Sources de documents :
  - **Local** : choisir un PDF sur l’appareil
  - **Hébergé** : documents stockés sur GitHub Pages (avec sous-dossiers)
- Mode hors-ligne (Service Worker)
- Interface tactile adaptée tablette & téléphone

## Déploiement sur GitHub Pages

1. Créez un dépôt GitHub (ex. `p83-printer`).
2. Uploadez **tout le contenu** de ce dossier à la racine du dépôt (ou dans un sous-dossier si vous préférez).
3. Dans les paramètres du dépôt → **Pages** → Source = branch `main` (ou `master`) / root.
4. L’application sera accessible à :  
   `https://VOTRE_USERNAME.github.io/p83-printer/`

### Ajouter des documents

1. Placez vos PDF dans le dossier `documents/` (vous pouvez créer des sous-dossiers : `factures/`, `notes/`, etc.).
2. Mettez à jour le fichier `documents/documents.json` pour décrire l’arborescence.

Exemple de `documents.json` :

```json
{
  "name": "Documents",
  "type": "folder",
  "children": [
    {
      "name": "Factures",
      "type": "folder",
      "path": "factures",
      "children": [
        {
          "name": "Facture janvier 2026.pdf",
          "type": "file",
          "path": "factures/facture-2026-01.pdf"
        }
      ]
    }
  ]
}
```

## Utilisation

1. Ouvrez l’application dans **Chrome** sur Android.
2. (Optionnel) Ajoutez-la à l’écran d’accueil → elle se comporte comme une app.
3. Appuyez sur **Connecter** et sélectionnez votre imprimante P83.
4. Choisissez un PDF (local ou hébergé).
5. Ajustez la densité et la largeur de papier si besoin.
6. Imprimez la page courante ou tout le document.

## Limitations importantes

- **Web Bluetooth** fonctionne bien sur **Chrome Android**.  
  Support très limité ou inexistant sur iOS Safari.
- Certaines versions de la P83 utilisent Bluetooth Classic (SPP). Web Bluetooth ne parle qu’au BLE. Si la connexion échoue, l’imprimante n’expose peut-être pas de service BLE compatible.
- La qualité d’impression des PDF dépend du rendu (texte dense = meilleur résultat avec densité « Forte »).
- Largeur A4 (216 mm) : l’imprimante doit être configurée pour ce format.

## Structure des fichiers

```
p83-printer-pwa/
├── index.html
├── style.css
├── app.js
├── sw.js
├── manifest.json
├── README.md
└── documents/
    ├── documents.json
    ├── factures/
    ├── notes/
    └── divers/
```

## Icônes (optionnel)

Pour une meilleure expérience « installer l’app », ajoutez :
- `icon-192.png` (192×192)
- `icon-512.png` (512×512)

Vous pouvez les générer facilement avec un outil en ligne (ex. realfavicongenerator.net).

## Améliorations possibles plus tard

- Dithering Floyd-Steinberg pour de meilleures images
- Support de plusieurs pages en un seul envoi optimisé
- Historique des impressions
- Mode sombre / clair
- Upload de PDF vers GitHub via l’API (avancé)

---

Créé pour une utilisation simple et fiable au quotidien sur tablette/téléphone Android.
