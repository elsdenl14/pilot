# Pilot × Supabase — mise en route (≈ 15 min)

## 1. Créer le projet
1. https://supabase.com → **New project** (région *West EU – Paris/Frankfurt*, mot de passe base de données à garder).
2. Attendez 1–2 min que le projet démarre.

## 2. Créer les tables
1. Menu **SQL Editor → New query**.
2. Collez **tout** le contenu de `supabase/schema.sql` → **Run**. (« Success » = c'est fait ; rejouable sans risque.)
3. Vérifiez dans **Table Editor** : `clients`, `chantiers`, `devis`, `factures`, `paiements`, `entreprise`, etc.

Ce que le schéma met en place :
| Besoin | Où / comment |
|---|---|
| Clients, chantiers | tables `clients`, `chantiers` |
| Devis + lignes | `devis`, `devis_lignes` — numéro auto `DEV-2026-001` |
| Factures + lignes | `factures`, `factures_lignes` — numéro auto **sans trou** `FAC-2026-001` |
| Paiements | `paiements` — le statut de la facture passe seul en *Partiellement payée* / *Payée* ; refuse un paiement supérieur au reste dû |
| Facture en retard | calculée dans la vue `v_factures` (échéance dépassée et non soldée) |
| Données comptes (CA, à encaisser…) | vue `v_clients_stats` + calculs de l'appli |
| Devis accepté → facture | fonction `devis_vers_facture` (bouton « Créer la facture ») |
| Fichiers (PDF, modèles, logo) | bucket privé `documents` (dossier = votre id utilisateur) |
| Sécurité | **RLS** : chaque compte ne voit que ses propres lignes |
| Conformité | une facture émise ne peut plus être supprimée ni modifiée (montant, client, numéro) : on l'**annule** |

## 3. Connecter le site
1. **Project Settings → API** : copiez *Project URL* et la clé **anon / publishable**.
2. Ouvrez `config.js` et remplacez les deux valeurs. (Jamais la clé `service_role`.)
3. Lancez le site (voir §5), puis **Créer le compte** avec votre email.

## 4. Sécuriser (important)
- **Authentication → Providers → Email** : gardez *Confirm email* activé (ou désactivez-le le temps des tests).
- Une fois **votre** compte créé : **Authentication → Sign In / Providers → désactivez « Allow new users to sign up »**, sinon n'importe qui ayant l'URL peut créer un compte. (Il ne verrait pas vos données grâce au RLS, mais autant fermer.)
- **Authentication → URL Configuration** : mettez l'adresse du site déployé dans *Site URL*.
- Base de données : activez les sauvegardes (plan Pro) ou exportez régulièrement (**Database → Backups**).

## 5. Lancer / publier
- Test local : dans le dossier, `python -m http.server 8000` puis http://localhost:8000
  (ne pas ouvrir `index.html` en double-clic : la connexion Supabase est plus fiable en http).
- Publication : le site est 100 % statique → Netlify, Vercel, Cloudflare Pages ou GitHub Pages (glisser le dossier).

## 6. Utilisation au quotidien
1. **Clients** → *Nouveau client*, puis **Chantiers** → *Nouveau chantier*.
2. **Devis** → *Nouveau devis* (montant HT + TVA 20/10/5,5/0 %) → *Marquer envoyé* → *Accepté* → **Créer la facture**.
3. **Factures** → *Émettre* (le numéro est déjà attribué ; après émission, plus de modification).
4. **Paiements** → *Enregistrer un paiement* sur une facture émise : statut, « à encaisser », « en retard » et analyses se mettent à jour.
5. Tout est aussi consultable/modifiable dans **Table Editor**, et exportable en CSV.

## 7. Aller plus loin (déjà prévu dans la base)
- **Lignes détaillées** : insérez dans `devis_lignes` / `factures_lignes` ; `montant_ht` du document est recalculé automatiquement. L'interface actuelle saisit un montant global ; un éditeur de lignes est la prochaine étape naturelle.
- **TVA multiple** (10 % et 20 % sur un même document) : il faudrait un taux par ligne (colonne `taux_tva` sur les lignes) — pas géré aujourd'hui.
- **PDF** : générer le PDF côté navigateur (jsPDF) ou via une *Edge Function*, puis l'envoyer dans le bucket `documents/<user_id>/...`.
- **Relances automatiques** : requête sur `v_factures where statut_affiche = 'En retard'` + Edge Function planifiée (cron).

## Notes
- Les données de démonstration de la maquette (Dupont, Martin…) ne sont **pas** importées : la base démarre vide.
- Les montants affichés dans les listes sont en **TTC** ; le CA et les analyses sont en **HT**.
