# Pilot v10 : mentions légales, anti-fraude TVA, Gmail, mails types, notes, PV de réception

## Installation (dans cet ordre)
1. Supabase > SQL Editor : exécutez **migration_v10.sql** (sans risque, peut être relancé).
2. Remplacez les fichiers de votre site par ceux fournis (nouveaux : views-legal.js, views-conformite.js, views-mail.js, views-notes.js, views-pv.js ; modifiés : index.html, core.js, app.js, views-finance.js, views-docs.js, views-activite.js, views-reglements.js, views-connexion.js, pdf.js, p.js).
3. Facultatif : Gmail, voir **GMAIL.md**.

## Où trouver quoi
- **Paramètres** : carte « Mentions légales automatiques » (19 mentions, contrôle, configuration), « Connexion Gmail », « Mails types ».
- **Comptabilité > Conformité** : journal inaltérable, contrôles, clôtures, archive ZIP.
- **Messagerie**, **Notes**, **PV de réception** : nouveaux items du menu. Les fiches client et chantier affichent leurs échanges, notes et PV.

## Anti-fraude TVA : ce qui est fait, ce qui ne l'est pas
Fait : factures émises verrouillées (modification et suppression refusées par la base), journal d'audit chaîné par empreintes SHA-256 non modifiable, paiements tracés (corrections visibles avec avant/après), clôtures de période, numérotation continue contrôlée, archive avec manifeste d'empreintes, empreinte imprimée en pied de chaque facture.
**Non fait : la certification.** Seul un organisme accrédité (AFNOR, INFOCERT, LNE…) délivre le certificat NF 525 ou une attestation. Pilot applique les principes mais ne peut pas s'auto-certifier. En cas de contrôle, le justificatif doit venir d'un tiers accrédité : parlez-en à votre comptable.
Conséquence à connaître : une facture émise ne se corrige plus. On crée un **avoir** puis une nouvelle facture.

## Limites connues
- Mentions légales : mentions usuelles du BTP, à faire valider par votre comptable ou un juriste.
- Gmail : la lecture de boîte est un droit « restreint » chez Google ; pour un usage personnel, publiez l'application en production (voir GMAIL.md).
- Signatures de PV : signature électronique « simple » (eIDAS), comme les devis.
