# Pilot v17 : navigation par domaines

## Ce qui change
- **Menu latéral par domaines** (repliables) : Accueil · Ventes · Chantiers · Achats · Équipes · Stocks et matériel · Finances · Pilotage · Documents et échanges · Administration (en bas).
  Le domaine de la page ouverte s'ouvre tout seul ; l'état replié/déplié est mémorisé. Menu réduit (icônes) : un clic sur un domaine ouvre sa première page.
- **Barre de sous-pages** en haut de chaque écran (ex. Ventes : Clients, Devis, Factures…) pour passer d'une page à l'autre sans rouvrir le menu.
- **Recherche rapide Ctrl+K** (ou Cmd+K, ou bouton en haut) : pages, clients, chantiers, devis, factures, fournisseurs.
- **Bouton « + Nouveau »** : devis, facture, client, chantier, note, bon de commande, dépense, fournisseur, salarié, pointage.
- Pages jusque-là absentes du menu, maintenant accessibles : Dépenses, Liens partagés, Maîtrise d'œuvre, Dossiers / Situations / Appels d'offres de sous-traitance, Sécurité et rôles.
- Les bons de commande restent surlignés sous Achats.
- Les profils de la v16 sont pris en compte : un domaine sans page autorisée disparaît, et une page interdite affiche « Accès non autorisé ».

## Branchement de la v16 (qui n'était pas actif dans le projet)
index.html charge maintenant views-securite.js, views-soustraitance.js, views-moe.js ; core.js appelle loadV16 (comme v13 à v15, sans bloquer si la migration manque), applyRole, et tabsAfterRender ; app.js ajoute leurs actions.
**Exécutez migration_v16.sql dans Supabase** pour que ces pages fonctionnent ; sinon elles affichent le message d'activation.

## Installation
Copiez les fichiers de ce dossier par-dessus ceux du projet (nav.js est nouveau). Si vos fichiers ont changé depuis, appliquez les patchs de `diffs/` (`patch -p0`) plutôt que de remplacer.

## Pour réorganiser
Tout est dans `DOMAINS` en haut de nav.js : déplacer une page = déplacer sa ligne.

## Limites
Testé dans un navigateur simulé avec une base factice (menu, sous-barre, Ctrl+K, Nouveau, profils, mobile), pas sur votre vraie base Supabase. Le menu « Nouveau » ouvre les formulaires existants sans pré-sélection de client/chantier.
