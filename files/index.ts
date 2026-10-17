// Fonction Supabase « stripe-webhook » : Stripe l'appelle quand un paiement est confirmé.
// À déployer SANS vérification JWT : supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets nécessaires : STRIPE_WEBHOOK_SECRET (whsec_…)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const enc = new TextEncoder();
async function verify(raw: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((x) => x.split("=") as [string, string]));
  const t = parts["t"], v1 = header.split(",").filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.includes(hex);
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const ok = await verify(raw, req.headers.get("stripe-signature") || "", Deno.env.get("STRIPE_WEBHOOK_SECRET") || "");
  if (!ok) return new Response("Signature invalide", { status: 400 });
  const ev = JSON.parse(raw);
  if (ev.type !== "checkout.session.completed" && ev.type !== "checkout.session.async_payment_succeeded") return new Response("ignoré", { status: 200 });
  const s = ev.data.object;
  if (s.payment_status !== "paid") return new Response("pas encore payé", { status: 200 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ref = "stripe:" + s.id;
  const { data: dejaP } = await sb.from("paiements").select("id").eq("reference", ref).maybeSingle();
  if (dejaP) return new Response("déjà enregistré", { status: 200 }); // Stripe peut renvoyer l'évènement

  const fid = s.metadata?.facture_id || s.client_reference_id;
  const { data: f } = await sb.from("v_factures").select("id,numero,reste,client_id,client_nom").eq("id", fid).maybeSingle();
  const { data: fo } = await sb.from("factures").select("user_id").eq("id", fid).maybeSingle();
  if (!f || !fo) return new Response("facture introuvable", { status: 200 });

  const paid = Math.round(Number(s.amount_total)) / 100;
  const reste = Math.max(0, Math.round(Number(f.reste) * 100) / 100);
  const appl = Math.min(paid, reste), exc = Math.round((paid - appl) * 100) / 100;
  const today = new Date().toISOString().slice(0, 10);
  let payId: string | null = null;
  if (appl > 0.005) {
    const { data: pay, error } = await sb.from("paiements").insert({ user_id: fo.user_id, facture_id: f.id, montant: appl, date_paiement: today, mode: "Carte", reference: ref }).select("id").single();
    if (error) return new Response("erreur : " + error.message, { status: 500 }); // Stripe réessaiera
    payId = pay.id;
  }
  if (exc > 0.005) await sb.from("client_credits").insert({ user_id: fo.user_id, client_id: f.client_id, montant: exc, type: "Trop-perçu", facture_id: f.id, paiement_id: payId, date_op: today, mode: "Carte", reference: ref, motif: `Excédent sur ${f.numero} (paiement en ligne)` });
  await sb.from("paiement_liens").update({ statut: "Payé", paid_at: new Date().toISOString() }).eq("ref_externe", s.id);
  try { await sb.from("notifications").insert({ user_id: fo.user_id, type: "paiement", titre: `Paiement reçu · ${f.numero}`, message: `${f.client_nom} a payé ${paid.toFixed(2)} € par carte.` }); } catch (_) { /* facultatif */ }
  return new Response("ok", { status: 200 });
});
