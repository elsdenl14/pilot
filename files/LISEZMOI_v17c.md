# Pilot v17c : création de devis et factures simplifiée

Contient tout de la v17b (navigation, vue financière, correctif mode sombre).

## Nouvel éditeur (devis et factures)
Toutes les fonctions sont conservées : sections, lignes, descriptions, TVA par ligne, bibliothèque, images, dictée vocale, coefficient de vente, chiffrage interne, options, marchés (lot/tranche), retenue de garantie, autoliquidation, poste libre, avenants.

Ce qui change :
- **4 étapes numérotées** : 1 Pour qui ? · 2 Date et validité (ou paiement) · 3 Prestations · 4 Remarques, chacune avec une phrase d'aide.
- **Barre « Que faut-il chiffrer ? »** : tapez un mot, les ouvrages de la bibliothèque s'affichent avec leur prix ; Entrée ou clic les ajoute (le curseur passe sur la quantité). Sans correspondance, Entrée ajoute une ligne libre.
- **Clavier** : Entrée passe au champ suivant (désignation, quantité, unité, prix), puis crée la ligne d'après. Entrée n'enregistre plus le document par erreur ; Ctrl+Entrée enregistre.
- **Lignes** : boutons monter, descendre, dupliquer, supprimer (visibles au survol).
- **Raccourcis** : validité 15/30/60/90 jours ; échéance à réception/30/45/60 jours ; remarques types en un clic.
- **Total en direct** dans la barre du bas, toujours visible, avec le nombre de prestations et un rappel s'il n'y en a pas.
- Les champs rares sont rangés : lot/sous-lot/tranche (marchés publics) et retenue de garantie/autoliquidation sont dans des volets repliés (ouverts s'ils sont déjà remplis).
- « Catégorie » devient « Section » ; « Nouveau facture » corrigé en « Nouvelle facture ».

## Installation
Copiez les fichiers par-dessus le projet (nav.js, views-accueil-fin.js, views-editeur.js sont nouveaux ; views-docs.js est modifié). Ou appliquez `diffs/`.
Limite : testé avec une base factice (saisie clavier, bibliothèque, duplication, enregistrement d'un devis, ouverture d'une facture), pas sur vos données réelles. Les remarques types sont des formulations neutres à adapter à vos conditions.
