// Fonction Supabase « pay-checkout » : crée une session de paiement Stripe pour une facture partagée.
// Appelée par la page client (p.html) avec le jeton privé du lien. Aucune connexion requise.
// Secrets nécessaires : STRIPE_SECRET_KEY (et SITE_URL = adresse de votre site Pilot, ex. https://monsite.fr)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, montant } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(String(token))) return json({ error: "Lien invalide." }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: p } = await sb.from("partages").select("doc_id,type").eq("token", token).maybeSingle();
    if (!p || p.type !== "facture") return json({ error: "Facture introuvable." }, 404);
    const { data: f } = await sb.from("v_factures").select("id,numero,reste,client_nom").eq("id", p.doc_id).maybeSingle();
    const { data: fo } = await sb.from("factures").select("user_id").eq("id", p.doc_id).maybeSingle();
    if (!f || !fo) return json({ error: "Facture introuvable." }, 404);
    const { data: e } = await sb.from("entreprise").select("paiement_en_ligne,nom").eq("user_id", fo.user_id).maybeSingle();
    if (e?.paiement_en_ligne !== "stripe") return json({ error: "Le paiement en ligne n'est pas activé." }, 403);

    const reste = Math.round(Number(f.reste) * 100) / 100;
    if (!(reste > 0.005)) return json({ error: "Cette facture est déjà réglée." }, 409);
    let m = Number(montant);
    if (!isFinite(m) || m < 1 || m > reste + 0.005) m = reste; // jamais plus que le reste dû
    m = Math.round(m * 100) / 100;

    const site = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
    const back = `${site}/p.html?t=${token}`;
    const body = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(Math.round(m * 100)),
      "line_items[0][price_data][product_data][name]": `Facture ${f.numero}${e?.nom ? " · " + e.nom : ""}`,
      success_url: back + "&paid=1",
      cancel_url: back,
      client_reference_id: String(f.id),
      "metadata[facture_id]": String(f.id),
      "metadata[user_id]": String(fo.user_id),
    });
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"), "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const s = await r.json();
    if (!r.ok) return json({ error: "Stripe a refusé la demande : " + (s?.error?.message || r.status) }, 502);
    await sb.from("paiement_liens").insert({ user_id: fo.user_id, facture_id: f.id, fournisseur: "stripe", ref_externe: s.id, montant: m, statut: "En attente" });
    return json({ url: s.url });
  } catch (err) {
    return json({ error: "Erreur : " + (err as Error).message }, 500);
  }
});
