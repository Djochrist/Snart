# Recette sur téléphone réel

À faire sur un Android modeste, avec Chrome, sur le site déployé en HTTPS : le GPS et l'installation ne marchent pas en HTTP sur un téléphone. Note pour chaque ligne : OK, ou ce que tu as vu.

Appareil : ________ · Android : ____ · Chrome : ____ · Réseau : ____ · Date : ____

## Installation

| # | Geste | Résultat attendu | Résultat |
|---|---|---|---|
| 1 | Ouvrir le site | Accueil affiché, logo net, pas de défilement horizontal | |
| 2 | Menu ⋮ → Installer l'application | L'icône bulle citron apparaît sur l'écran d'accueil, sans bord blanc | |
| 3 | Ouvrir depuis l'icône | Écran vert nuit puis Snart, sans barre d'adresse | |
| 4 | Tourner le téléphone | L'écran suit, le bouton Signaler reste accessible | |

## GPS

| # | Geste | Résultat attendu | Résultat |
|---|---|---|---|
| 5 | Signaler → Utiliser mon GPS, accepter | « Position obtenue » avec une précision en mètres | |
| 6 | Noter si la position correspond au lieu réel | Écart proche de la précision annoncée | |
| 7 | Paramètres du site → bloquer la position, recommencer | Message de refus, épingle proposée | |
| 8 | Placer l'épingle au doigt, la faire glisser | Coordonnées mises à jour, la page ne défile pas en même temps | |
| 9 | Fiche → Toujours présent, à moins de 150 m | Confirmation proche comptée par le serveur | |
| 10 | Même geste depuis un autre téléphone, loin du lieu | Compté à distance | |

## Photo

| # | Geste | Résultat attendu | Résultat |
|---|---|---|---|
| 11 | Prendre une photo | L'appareil photo s'ouvre, aperçu affiché | |
| 12 | Choisir une image | La galerie s'ouvre, les captures d'écran sont accessibles | |
| 13 | Envoyer, ouvrir la fiche, Afficher la photo | Photo bien orientée | |
| 14 | Choisir une image de plus de 8 Mo | Message clair, envoi sans photo possible | |

## Réseau instable

| # | Geste | Résultat attendu | Résultat |
|---|---|---|---|
| 15 | Passer en mode avion, ouvrir Snart | L'interface s'ouvre, « Hors ligne » affiché | |
| 16 | Envoyer un signalement avec photo | « En attente d'envoi, pas encore publié » | |
| 17 | Fermer l'application, la rouvrir | Le signalement est toujours là | |
| 18 | Couper le mode avion, rouvrir Snart | Envoi automatique, le signalement apparaît une seule fois | |
| 19 | Réseau 2G ou Edge, ouvrir l'accueil | Texte lisible en quelques secondes, carte chargée seulement sur l'écran Carte | |

## Lisibilité

| # | Geste | Résultat attendu | Résultat |
|---|---|---|---|
| 20 | En plein soleil, lire une fiche | Texte et boutons lisibles | |
| 21 | Agrandir le texte dans les réglages Android | Rien n'est coupé | |
| 22 | Activer TalkBack, parcourir une fiche | Catégorie, statut et fiabilité sont annoncés | |
