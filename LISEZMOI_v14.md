# Pilot v14 : appels d'offres, marchés complexes et facturation BTP avancée

Cette version part de vos fichiers v13 (chiffrage) et de la v12 (planning, ressources, pilotage).

## Installation
1. Supabase > SQL Editor : exécuter `migration_v14.sql` (une fois, relançable). Les migrations v1 à v13 doivent être faites.
2. Copier dans votre projet (remplace les fichiers existants) :
   `index.html`, `app.js`, `core.js`, `lib.js`, `style.css`, `pdf.js`, `views-docs.js`, `views-facturation.js`, `views-chiffrage.js`, `views-activite.js`.
3. Ajouter les nouveaux fichiers : `views-marches.js`, `views-btp.js` et le dossier `vendor/` avec `xlsx.full.min.js` (lecture et écriture des fichiers Excel, SheetJS 0.18.5).
4. Recharger Pilot. Un nouveau menu **Marchés et analyses** apparaît sous « Devis ».

Si vous avez modifié vous-même l'un de ces fichiers depuis la v13, ne le remplacez pas : reportez les blocs correspondants.

## Appels d'offres et marchés complexes
- **Import DPGF / DQE / BPU** (Marchés > Importer un bordereau). Pilot détecte la feuille, la ligne d'en-têtes et les colonnes (désignation, unité, quantité, prix, total) ; vous pouvez corriger chaque colonne avant de valider. Il crée un devis en brouillon avec toutes les lignes, et garde le fichier Excel d'origine.
- **Structure conservée** : les titres deviennent lots, sous-lots et chapitres (d'après la numérotation 1 / 1.1 / 1.1.1 ou le mot « Lot »). Les titres « Tranche ferme » ou « Tranche conditionnelle » ouvrent une tranche.
- **Réexport** (fiche devis > Bordereau) : « Réexporter dans le fichier d'origine » écrit vos prix, quantités et totaux dans le fichier reçu, à la même place. Il garde la mise en page et recalcule les formules à l'ouverture. Vous pouvez aussi exporter un DPGF, un DQE ou un BPU (avec prix en lettres) construit par Pilot.
- **Lots, sous-lots, tranches** : l'éditeur de devis affiche, pour chaque catégorie, les champs Lot, Sous-lot, Tranche et le type (ferme ou conditionnelle). Une tranche conditionnelle n'est pas comptée dans le total (devis, PDF, situations, facture) tant qu'elle n'est pas **affermie** (bouton sur la fiche devis). La fiche affiche les montants par lot et par tranche.
- **Axes analytiques** (Marchés > Axes analytiques) : créez vos axes (type de marché, équipe, conducteur, activité, agence) et leurs valeurs, ou partez des axes types. Posez les étiquettes sur chaque chantier et chaque devis. Le tableau compare les valeurs : chantiers, facturé, coûts réels, marge, devis acceptés et en attente.

## Facturation BTP avancée
Déjà présents depuis la v8 et conservés : acomptes (% ou montant), situations par poste ou par ligne avec cumul, facture finale, retenue de garantie, prime, compte prorata, escompte, avoirs.

Ajouté ou complété :
- **Acompte déduit automatiquement des situations** : chaque situation reprend l'acompte au prorata de son avancement, dans la limite de l'acompte facturé. La facture finale déduit ensuite le reste. Le total facturé retombe sur le marché.
- **Situations par lot et par quantité** : si vos lignes ont un lot, la situation par poste suit les lots. En situation détaillée, une colonne « Qté cumulée » est liée au pourcentage.
- **Proforma** (fiche devis) : document PDF provisoire numéroté PRO-AAAA-001, sans numéro de facture ni effet comptable.
- **Révision de prix** : paramétrez la formule du marché sur le devis (indice, mois de référence I0, part fixe a). Saisissez les valeurs d'indices (onglet Indices). Dans la situation, choisissez le mois d'indice : la ligne « Révision de prix » est ajoutée avec le détail du calcul `Cn = a + (1 − a) × In / I0`. La facture finale ne reprend pas la révision en déduction.
- **DGD** (fiche d'un devis accepté) : marché initial, avenants acceptés, révision, acomptes, situations, facture finale, avoirs, retenue, primes, règlements et solde, en PDF à signer. Un avenant se crée avec le bouton « Avenant » du devis accepté : il est rattaché à son devis d'origine.
- **Autoliquidation de TVA** : champ dans les formulaires de situation, de facture finale et de facture libre. Toutes les lignes passent à 0 % et le PDF porte la mention d'autoliquidation (art. 283-2 nonies du CGI).
- **Attestation de TVA à taux réduit** : sur la fiche chantier ou dans Marchés > Attestations TVA. Pilot pré-remplit client, adresse des travaux, local et nature des travaux, et range le PDF dans Documents.
- **Aides et primes** (fiche devis) : MaPrimeRénov', CEE, aides locales, avec état estimée, validée, perçue ou refusée. Elles apparaissent sur le devis PDF avec le reste à charge. Les aides validées préremplissent la prime de la facture finale.
- **Déchets de chantier** (Marchés > Déchets, et carte sur la fiche chantier) : type, quantité, coût, prestataire, filière, n° de bordereau et justificatif joint.

## Limites à connaître
- Testé avec une base Supabase simulée (import, export, lots, tranches, situations, révision, DGD, PDF), pas sur votre vraie base : lancez la migration puis essayez un devis de test.
- L'import suppose un bordereau en une seule feuille avec une ligne d'en-têtes. Les bordereaux très atypiques demandent de corriger les colonnes dans l'écran d'import. Si les prix sont des formules dans le fichier d'origine, Pilot les remplace par des valeurs.
- Le fichier réexporté conserve les styles de base. Les éléments avancés (images, graphiques, macros) ne sont pas garantis.
- Les valeurs d'indices BT / TP sont à saisir à la main depuis l'INSEE. La révision provisoire puis définitive n'est pas gérée.
- L'attestation de TVA n'est pas le Cerfa officiel : c'est une aide au remplissage. L'autoliquidation est à valider selon votre situation fiscale. Elle n'est pas gérée côté factures de vos propres sous-traitants.
- Le DGD est calculé à partir des factures émises dans Pilot ; il ne calcule pas de pénalités.
- Si vous changez les tranches affermies d'un devis déjà envoyé, renvoyez le devis : le PDF partagé n'est pas régénéré automatiquement.
