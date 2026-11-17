// Fonction Supabase « gmail » : connexion à Gmail (envoi + lecture) pour Pilot.
// Secrets : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SITE_URL (adresse de Pilot, ex. https://monsite.fr)
// Les jetons Google restent dans la table gmail_connexions, illisible depuis le navigateur.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid email";

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`);
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

function buildMime(from: string, to: string, subject: string, body: string, atts: { filename: string; mime: string; b64: string }[]) {
  const bd = "pilot_" + crypto.randomUUID().replace(/-/g, "");
  const h = [`From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${bd}"`, "", `--${bd}`,
    'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", wrap76(btoa(unescape(encodeURIComponent(body))))];
  for (const a of atts) {
    h.push(`--${bd}`, `Content-Type: ${a.mime || "application/octet-stream"}; name="${encHeader(a.filename)}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${encHeader(a.filename)}"`, "", wrap76(a.b64));
  }
  h.push(`--${bd}--`, "");
  return h.join("\r\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!, srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, srv);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    const uid = u?.user?.id;
    if (!uid) return json({ error: "Connexion requise." }, 401);
    const body = await req.json();
    const cid = Deno.env.get("GOOGLE_CLIENT_ID"), cs = Deno.env.get("GOOGLE_CLIENT_SECRET"), site = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
    if (!cid || !cs) return json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants dans les secrets Supabase." }, 500);
    const redirect = site + "/";

    if (body.action === "auth_url") {
      const state = "gm:" + crypto.randomUUID();
      const p = new URLSearchParams({ client_id: cid, redirect_uri: redirect, response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", state, login_hint: body.email || "" });
      return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + p, state });
    }

    if (body.action === "callback") {
      const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: body.code, client_id: cid, client_secret: cs, redirect_uri: redirect, grant_type: "authorization_code" }) });
      const t = await r.json();
      if (!r.ok) return json({ error: "Google a refusé la connexion : " + (t.error_description || t.error) }, 400);
      if (!t.refresh_token) return json({ error: "Google n'a pas renvoyé d'autorisation durable. Retirez Pilot dans votre compte Google (Sécurité > Accès tiers) puis recommencez." }, 400);
      const prof = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + t.access_token } })).json();
      await admin.from("gmail_connexions").upsert({ user_id: uid, email: prof.emailAddress || null, access_token: t.access_token, refresh_token: t.refresh_token,
        expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), statut: "Active", erreur: null });
      return json({ email: prof.emailAddress });
    }

    const { data: cx } = await admin.from("gmail_connexions").select("*").eq("user_id", uid).maybeSingle();
    if (body.action === "disconnect") {
      if (cx?.refresh_token) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(cx.refresh_token), { method: "POST" }).catch(() => {});
      await admin.from("gmail_connexions").delete().eq("user_id", uid);
      return json({ ok: true });
    }
    if (!cx) return json({ error: "Gmail n'est pas connecté." }, 400);

    let token = cx.access_token;
    if (!cx.expires_at || new Date(cx.expires_at).getTime() < Date.now()) {
      const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: cid, client_secret: cs, refresh_token: cx.refresh_token, grant_type: "refresh_token" }) });
      const t = await r.json();
      if (!r.ok) {
        await admin.from("gmail_connexions").update({ statut: "Erreur", erreur: String(t.error_description || t.error).slice(0, 300) }).eq("user_id", uid);
        return json({ error: "La connexion Gmail a expiré : reconnectez-la dans Paramètres." }, 401);
      }
      token = t.access_token;
      await admin.from("gmail_connexions").update({ access_token: token, expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), statut: "Active", erreur: null }).eq("user_id", uid);
    }
    const g = (path: string, init: RequestInit = {}) => fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });

    if (body.action === "send") {
      const { to, subject, text, attachments = [], from_name } = body;
      if (!to || !subject) return json({ error: "Destinataire et objet requis." }, 400);
      const from = from_name ? `${encHeader(from_name)} <${cx.email}>` : cx.email;
      const raw = b64url(buildMime(from, to, subject, text || "", attachments));
      const r = await g("messages/send", { method: "POST", body: JSON.stringify({ raw }) });
      const j = await r.json();
      if (!r.ok) return json({ error: "Envoi refusé par Gmail : " + (j.error?.message || r.status) }, 400);
      return json({ id: j.id, thread_id: j.threadId, from: cx.email });
    }

    if (body.action === "sync") {
      // body.emails : adresses des clients/fournisseurs à suivre ; body.days : profondeur (défaut 30)
      const emails: string[] = (body.emails || []).filter((e: string) => /^[^\s@]+@[^\s@]+$/.test(e)).slice(0, 40);
      const days = Math.min(365, Number(body.days) || 30);
      const qy = (emails.length ? `(${emails.map((e) => `from:${e} OR to:${e}`).join(" OR ")}) ` : "") + `newer_than:${days}d`;
      const lr = await g("messages?maxResults=60&q=" + encodeURIComponent(qy));
      const lj = await lr.json();
      if (!lr.ok) return json({ error: "Lecture Gmail refusée : " + (lj.error?.message || lr.status) }, 400);
      const out: unknown[] = [];
      for (const m of (lj.messages || []).slice(0, 60)) {
        const mr = await g(`messages/${m.id}?format=full`);
        const mj = await mr.json();
        if (!mr.ok) continue;
        const H = (n: string) => (mj.payload?.headers || []).find((h: { name: string }) => h.name.toLowerCase() === n)?.value || "";
        const pieces: { nom: string; mime: string; attachment_id: string; taille: number }[] = [];
        const walk = (p: any) => { if (!p) return; if (p.filename && p.body?.attachmentId) pieces.push({ nom: p.filename, mime: p.mimeType, attachment_id: p.body.attachmentId, taille: p.body.size || 0 }); (p.parts || []).forEach(walk); };
        walk(mj.payload);
        out.push({ gmail_id: m.id, thread_id: mj.threadId, de: H("from"), a: H("to"), sujet: H("subject"), extrait: mj.snippet || "", date_mail: new Date(Number(mj.internalDate)).toISOString(),
          direction: (mj.labelIds || []).includes("SENT") ? "sortant" : "entrant", lu: !(mj.labelIds || []).includes("UNREAD"), pieces });
      }
      await admin.from("gmail_connexions").update({ derniere_synchro: new Date().toISOString() }).eq("user_id", uid);
      return json({ messages: out });
    }

    if (body.action === "attachment") {
      const r = await g(`messages/${body.gmail_id}/attachments/${body.attachment_id}`);
      const j = await r.json();
      if (!r.ok) return json({ error: "Pièce jointe introuvable." }, 404);
      return json({ data: String(j.data).replace(/-/g, "+").replace(/_/g, "/") });
    }
    return json({ error: "Action inconnue." }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
