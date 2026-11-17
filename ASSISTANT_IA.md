# Assistant IA intégré (bouton « Assistant » en bas à droite)

Sans configuration, l'assistant répond déjà à quelques questions simples (impayés, devis à relancer, trésorerie, chantiers à risque, CA, journal).
Pour des questions libres, activez l'IA :

1. Créez une clé API sur console.anthropic.com.
2. Copiez `assistant-ia-index.ts` en `supabase/functions/assistant-ia/index.ts`.
3. `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (optionnel : `ANTHROPIC_MODEL=...`)
4. `supabase functions deploy assistant-ia`

Confidentialité : le navigateur envoie un **résumé** (chantiers, factures impayées, devis, trésorerie, derniers journaux) filtré selon le profil actif ; jamais les mots de passe, RIB, pièces jointes ni photos. Vérifiez les chiffres importants.
