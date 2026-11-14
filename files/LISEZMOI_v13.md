# Pilot v13 : Chiffrage avancé et études de prix

## Installation
1. Supabase > SQL Editor : exécuter `migration_v13.sql` (une fois, relançable).
2. Copier les fichiers de ce dossier dans votre projet (ils remplacent les versions existantes) :
   `views-chiffrage.js` (nouveau), `views-docs.js`, `views-facturation.js`, `views-ouvrages.js`, `views-signature.js`, `pdf.js`, `p.js`, `p.css`, `core.js`, `app.js`, `index.html`, `style.css`.
3. Recharger l'application.

**Attention :** les fichiers fournis partent de vos versions v10 (pilot-main1) pour `views-docs.js`, `views-facturation.js`, `views-ouvrages.js`, `views-signature.js`, `pdf.js`, `p.js`, `p.css`, et de votre v12 pour `core.js`, `app.js`, `index.html`, `style.css`. Si vous avez modifié l'un d'eux depuis (v11), ne remplacez pas le fichier : appliquez le diff correspondant du dossier `patches/` (`patch -p0 fichier < patches/fichier.diff`, ou reprise à la main, ce sont de petits blocs).

## Ce qui est ajouté
1. **Déboursés secs par ligne** : dans l'éditeur de devis, chaque ligne a un bloc « Chiffrage interne » (matériaux, heures de main-d'œuvre × coût horaire, matériel, sous-traitance, par unité) qui donne le coût de revient.
2. **Coefficient de vente** : bouton « Coefficient de vente » (frais fixes annuels ÷ CA visé, ou % de frais généraux ; bénéfice visé ; coefficient de sous-traitance). Coefficient = 1 ÷ (1 − frais généraux − bénéfice). Le bouton « Appliquer le prix proposé » reporte le prix sur la ligne.
3. **Marge prévisionnelle** : en € et en % par ligne, par catégorie et sur le devis, dans l'éditeur et sur la fiche devis. Elle n'est jamais écrite dans le PDF, la page client ni les fonctions publiques.
4. **Ouvrages composés** : bouton « Sous-détail » dans la bibliothèque (matériaux, main-d'œuvre, matériel, sous-traitance). Quand on ajoute l'ouvrage à un devis, ses déboursés sont repris.
5. **Options et variantes** : case « Option » sur une ligne (non comprise dans le total) + nom de variante (même nom = un seul choix). Le client coche ses options sur la page en ligne, le total est recalculé et enregistré à la signature. Le PDF liste les options proposées ; le certificat de signature indique celles retenues. Les options non retenues ne sont pas facturées.
6. **Métrés** : champ « Métré » (ex. `4,5*3 + 2*1,2` ou `L=4; l=3; L*l`) qui calcule la quantité. Opérations + − × ÷ ^ ( ), fonctions round, ceil, floor, sqrt, abs, max, min, pi.
7. **Images** : bouton « + Image » dans l'éditeur (photos ou schémas, réduits à 1400 px). Elles s'affichent dans le PDF, à leur place entre les lignes, avec une légende facultative. Elles ne sont pas facturées.
8. **Dictée vocale** : bouton « Dictée vocale » dans l'éditeur et « Avenant » sur un devis accepté. Reconnaissance vocale du navigateur (Chrome, Edge, Safari) ou saisie au clavier ; le texte est découpé en postes (quantité, unité, désignation) rapprochés de votre bibliothèque ; vous relisez et cochez avant ajout.

## Limites à connaître
- Testé avec une base Supabase simulée (éditeur, calculs, enregistrement, page client, PDF). Non testé sur votre vraie base : lancez la migration puis essayez un devis de test.
- La dictée n'utilise pas d'IA : elle découpe le texte par règles et cherche dans votre bibliothèque. Les phrases complexes demandent une relecture.
- Un « avenant » est un nouveau devis lié par sa mention, pas un type de document séparé.
- Le client choisit ses options avec la signature électronique simple déjà en place. Le PDF consulté reste celui du devis de base, le total affiché et enregistré tient compte des choix.
- La marge vaut ce que valent les déboursés saisis : une ligne sans déboursé n'est pas comptée (signalé à l'écran).
