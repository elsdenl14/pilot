# Pilot v17b : correctif mode sombre + vue financière à l'accueil

Cette version remplace la v17 (elle contient tout ce qu'elle apportait : navigation par domaines, Ctrl+K, « + Nouveau », branchement v16).

## Correctif mode sombre
Cause : des styles (onglets internes, planning, tableaux de facture…) utilisaient des variables de couleur jamais définies (`--card`, `--bg2`, `--in`, `--wnbg`, `--accent`), donc un fond blanc restait en mode sombre sous un texte clair. Elles sont maintenant définies dans style.css à partir du thème (clair ou sombre).

## Accueil : « Vue financière »
Bloc pleine largeur sous les indicateurs : 4 chiffres sur 12 mois (CA facturé HT, encaissé, dépenses payées, résultat de trésorerie) et un graphique : barres d'encaissements et de dépenses payées par mois, courbe du solde de trésorerie cumulé. Survol d'un mois = détail.
- Visible pour les profils ayant la permission « Banque, paiements et trésorerie ».
- Modifiable via « Personnaliser » (ligne « Vue financière »).
- Le solde cumulé part de la trésorerie initiale des paramètres et reprend les ajustements de règlements, comme l'indicateur « Trésorerie estimée ».

## Installation
Copiez les fichiers par-dessus le projet (nav.js et views-accueil-fin.js sont nouveaux). Ou appliquez `diffs/`.
Limite : testé avec une base factice, pas sur vos données réelles.
