// Fonction Supabase « assistant-ia » : répond aux questions de l'utilisateur à partir du résumé de ses données.
// Déploiement : supabase functions deploy assistant-ia      (la vérification JWT reste activée : seul un utilisateur connecté peut l'appeler)
// Secret requis : supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      Optionnel : ANTHROPIC_MODEL
// Copiez ce fichier en supabase/functions/assistant-ia/index.ts avant de déployer.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM = `Tu es l'assistant de gestion d'une entreprise du bâtiment, intégré au logiciel Pilot.
Tu réponds en français, de façon courte, concrète et chiffrée, à partir UNIQUEMENT des données fournies dans le CONTEXTE (JSON).
Règles :
- N'invente jamais un chiffre, un nom ou une date. Si l'information n'est pas dans le contexte, dis-le simplement.
- Cite les noms de chantiers, clients et numéros de documents pour que l'utilisateur retrouve l'élément.
- Montants en euros avec séparateur d'espaces (ex : 12 450 €), précise HT ou TTC.
- Termine par une action utile quand c'est pertinent (relancer, vérifier, facturer), en une phrase.
- Format : phrases courtes, listes à puces pour 3 éléments ou plus, **gras** pour les chiffres clés. Pas de tableaux, pas de titres.
- Tu ne donnes pas de conseil juridique, fiscal ou comptable définitif : tu proposes de le vérifier avec le comptable.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY manquant côté serveur." }, 500);
    const { messages, context } = await req.json();
    if (!Array.isArray(messages) || !messages.length) return json({ error: "Question manquante." }, 400);
    const ctx = JSON.stringify(context ?? {}).slice(0, 60000);
    const msgs = messages.slice(-12).map((m: { role: string; content: string }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 4000) }));
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5", max_tokens: 900, system: `${SYSTEM}\n\nCONTEXTE (données de l'entreprise, date du jour incluse) :\n${ctx}`, messages: msgs }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: out?.error?.message || "Erreur du service IA." }, 502);
    const answer = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
    return json({ answer });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
