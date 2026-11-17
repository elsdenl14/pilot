# Pilot v18 : devis et factures, nouveau rendu

Fichiers modifiés : `pdf.js`, `views-docs.js`, `style.css` (copiez-les par-dessus le projet). Aucune migration.

## PDF
- En-tête épuré : entreprise à gauche, type + numéro à droite, client et dates sur une même ligne.
- Tableau à 5 colonnes (Désignation, Quantité, Prix unitaire, TVA, Total HT), sections numérotées avec leur sous-total, sans fond zébré.
- Récapitulatif par poste placé à côté des totaux ; Total TTC bien visible.
- Filigrane « BROUILLON » ; conditions et mentions plus compactes.

## Éditeur
- 3 blocs : Client + Dates, Prestations, Remarques + Total (plus d'étapes numérotées ni de textes d'aide).
- Saisie type tableur : champs discrets, description visible quand on clique sur la ligne, boutons monter/descendre/dupliquer au survol.
- Total toujours visible en bas ; aperçu à l'écran aligné sur le PDF.
