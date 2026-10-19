# Connecter Gmail à Pilot

Une fois fait, Pilot peut **envoyer** devis, factures, relances et PV depuis votre Gmail (avec le PDF en pièce jointe), **lire** votre boîte pour classer les échanges par client, et **importer** les factures fournisseur reçues en pièce jointe.
Sans cette étape, Pilot fonctionne quand même : les messages s'ouvrent dans votre messagerie habituelle.

Comptez 20 à 30 minutes, une seule fois.

## 1. Créer le projet Google
1. Allez sur https://console.cloud.google.com et créez un projet (nom : « Pilot »).
2. Menu **API et services > Bibliothèque** : cherchez **Gmail API** et cliquez sur **Activer**.
3. Menu **API et services > Écran de consentement OAuth** :
   - Type d'utilisateur : **Externe**.
   - Nom de l'application : Pilot. Email d'assistance et de contact : le vôtre.
   - Champs d'application (scopes) : ajoutez `.../auth/gmail.send` et `.../auth/gmail.readonly`.
   - **Important : passez l'application en « En production »** (bouton « Publier l'application »). Si elle reste en « Test », Google coupe la connexion tous les 7 jours.
   - Google affichera « application non validée » à la première connexion : c'est normal pour un usage personnel (moins de 100 utilisateurs). Cliquez sur « Paramètres avancés > Accéder à Pilot ».
4. Menu **Identifiants > Créer des identifiants > ID client OAuth** :
   - Type : **Application Web**.
   - **URI de redirection autorisé** : l'adresse de votre site Pilot suivie d'une barre oblique, par exemple `https://monsite.fr/`
   - Notez l'**ID client** et le **Code secret**.

## 2. Installer la fonction sur Supabase
1. Dans Supabase : **Edge Functions > Create function**, nom : `gmail`, collez le contenu de `supabase/functions/gmail/index.ts`, puis **Deploy** (laissez « Verify JWT » activé).
2. **Edge Functions > Secrets**, ajoutez :
   - `GOOGLE_CLIENT_ID` : l'ID client
   - `GOOGLE_CLIENT_SECRET` : le code secret
   - `SITE_URL` : l'adresse de Pilot, par exemple `https://monsite.fr` (sans barre à la fin)

## 3. Connecter
Dans Pilot : **Paramètres > Connexion Gmail > Connecter Gmail**, choisissez votre compte, acceptez. Vous revenez dans Pilot, connecté.

## À savoir
- Vos identifiants Google ne quittent jamais Supabase : le navigateur n'y a pas accès.
- Pilot lit uniquement les messages échangés avec les adresses de vos clients et fournisseurs.
- Pour couper l'accès : bouton « Déconnecter » dans Pilot, ou myaccount.google.com > Sécurité > Accès tiers.
- Si le message « La connexion Gmail a expiré » apparaît, cliquez sur « Reconnecter ».
