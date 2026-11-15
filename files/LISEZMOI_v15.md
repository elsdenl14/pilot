# Pilot v15 : Terrain, équipes et ressources / Stocks, matériel et approvisionnements

## Installation
1. Supabase > SQL Editor : exécuter `migration_v15.sql` (une fois, relançable). Les migrations v1 à v14 doivent être faites.
2. Copier dans votre projet, à la racine (même dossier que `index.html`) :
   - nouveaux fichiers : `views-equipes.js`, `views-stocks.js`, `terrain.html`, `terrain.js`, `terrain.css`, `terrain.webmanifest`, `sw-terrain.js`
   - fichiers modifiés : `core.js`, `app.js`, `index.html`, `style.css` (partent de votre v14)
   Si vous avez modifié ces 4 fichiers depuis la v14, utilisez les diffs du dossier `patches/` à la place : ce sont de petits blocs (icônes et menu, chargement des données, deux scripts, quelques styles).
3. Recharger Pilot. Un nouveau groupe de menu « Terrain et stocks » apparaît.

## 04 Terrain, équipes et ressources
- **Pointage mobile** (haute) : dans « Équipes et salariés », chaque salarié a un lien privé (copier, SMS, régénérer). Sur son téléphone, il saisit ses heures par chantier et par tâche, avec panier et trajet. Dans « Pointages et paie », le responsable contrôle, corrige, valide ou refuse. À la validation, les heures vont dans « Temps passés » avec le coût horaire chargé, donc dans la rentabilité des chantiers.
- **Coûts horaires chargés** : calcul à partir du salaire brut, des charges et des heures mensuelles, ou saisie directe ; repli sur le coût de l'équipe puis sur le coût horaire de l'entreprise.
- **Heures supplémentaires, absences, indemnités** : onglet « Heures et paie » par mois (HS à 25 % et 50 % par semaine, paramétrables), absences (congés, maladie, etc.), paniers et trajets, export CSV pour la paie.
- **Planning et conflits** : page « Affectations » (salariés, équipes, équipements). Elle détecte les chevauchements, y compris un salarié déjà pris via son équipe, une absence ou une indisponibilité de matériel, avec prise en compte des créneaux horaires. Un avertissement apparaît dès la saisie.
- **Rapports d'intervention signés** : sur mobile, rapport avec constat, travaux, fournitures, photos et signature du client au doigt. Dans « Rapports et photos » : consultation, PDF, et « Préparer la facture » (main-d'œuvre au taux de vente + fournitures, dans l'éditeur de facture).
- **Mode hors connexion** : la page mobile garde chantiers, tâches et heures en mémoire, enregistre heures, rapports et photos sans réseau, puis envoie tout seule au retour de la connexion (sans doublon). À ouvrir une première fois avec du réseau, puis à ajouter à l'écran d'accueil.

## 05 Stocks, matériel et approvisionnements
- **Stocks par dépôt et véhicule** (haute) : articles, lieux, entrées, sorties vers un chantier, transferts, retours. Alerte sous le seuil, prix moyen pondéré, valeur par lieu, matière sortie par chantier.
- **Inventaires et valorisation** : comptage par lieu, écarts, validation qui crée les mouvements d'ajustement ; valeur du stock conservée par inventaire.
- **Disponibilité du matériel** : page « Disponibilité matériel » (calendrier 3 semaines, « Qui est libre ? », locations avec coût, indisponibilités). Reprend les affectations de la fiche Matériel.
- **Rapprochement commande / livraison / facture** : saisie d'une commande, de ses livraisons (avec entrée en stock facultative) et des factures reçues ; signale reliquats, livré en trop, facturé non livré, facturé au-delà de la commande, écart de prix. Export CSV des écarts.

## Limites à connaître
- Testé avec une base Supabase simulée et un navigateur automatisé (calculs, validations, conflits, stocks, rapprochement, page mobile hors connexion, signature, PDF). Non testé sur votre vraie base ni sur un vrai téléphone : essayez avec un salarié de test.
- Le lien de pointage n'est pas un compte : quiconque le possède peut saisir des heures au nom du salarié. Régénérez-le en cas de perte. Les photos sont stockées dans la base (réduites à 1280 px) ; pour beaucoup de photos, prévoyez de passer par Storage plus tard.
- Les heures supplémentaires suivent les valeurs par défaut du code du travail (35 h, 25 % puis 50 % au-delà de 43 h). Vérifiez avec votre convention collective. Le CSV prépare la paie, il ne remplace pas votre logiciel de paie.
- Le rapprochement est indépendant de vos bons de commande (module v11) : je n'avais pas ces fichiers. La commande se saisit ici. Dites-moi si vous voulez le relier aux bons de commande existants.
- Le mode hors connexion ne couvre que la page mobile terrain, pas tout Pilot.
- Sorties de stock vers un chantier : valorisées au prix moyen ; ne les comptez pas une seconde fois si vous saisissez aussi l'achat en dépense du chantier.
