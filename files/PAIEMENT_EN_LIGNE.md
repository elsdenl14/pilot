# Activer le paiement par carte (Stripe Checkout)

Le paiement par carte ne peut pas fonctionner uniquement dans le navigateur : la clé secrète Stripe doit rester côté serveur.
Pilot utilise donc deux petites fonctions Supabase (dossier `supabase/functions`). **Rien n'est obligatoire** : sans elles, vos clients paient par virement (RIB + QR code), par chèque, ou via un lien de paiement externe (option « lien » dans Paramètres).

1. Créez un compte sur stripe.com et récupérez votre clé secrète (`sk_live_…`, ou `sk_test_…` pour essayer).
2. Installez la CLI Supabase, puis dans le dossier du projet :
   ```
   supabase login
   supabase link --project-ref VOTRE_REF
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... SITE_URL=https://votre-site.fr
   supabase functions deploy pay-checkout
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
3. Dans Stripe > Développeurs > Webhooks, ajoutez l'adresse
   `https://VOTRE_REF.supabase.co/functions/v1/stripe-webhook`
   pour les évènements `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
   Copiez le « secret de signature » (`whsec_…`) puis : `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`
4. Dans Pilot > Paramètres > RIB et paiement en ligne > Configurer : choisissez « Stripe Checkout ».
5. Testez en mode test avec la carte `4242 4242 4242 4242` : le paiement apparaît dans Paiements, la facture passe à « Payée ».

Frais : Stripe prélève ses commissions sur chaque paiement. Le paiement est enregistré en mode « Carte » avec la référence `stripe:…` (pas de doublon si Stripe renvoie l'évènement).
Si le client paie plus que le reste dû (ex. deux onglets ouverts), l'excédent est gardé en crédit client.
