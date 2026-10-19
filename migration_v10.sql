-- Pilot · migration v10
--   1. Mentions légales automatiques (réglages)
--   2. Conformité « anti-fraude TVA » : journal inaltérable chaîné, verrouillage des factures émises, clôtures de période
--   3. Mails types, connexion Gmail, historique des mails
--   4. Prises de notes
--   5. Procès-verbaux de réception + signature client
-- À exécuter une fois dans Supabase > SQL Editor. Idempotent : peut être relancé sans risque.
-- Prérequis : migrations v1 à v9 déjà exécutées.

-- ============================================================
-- 1. Mentions légales
-- ============================================================
alter table public.entreprise add column if not exists mentions_options jsonb not null default '{}'::jsonb;

-- ============================================================
-- 2. Conformité anti-fraude TVA
-- ============================================================
create table if not exists public.audit_journal (
  id bigserial primary key,
  user_id uuid not null,
  seq bigint not null,
  at timestamptz not null default clock_timestamp(),
  evenement text not null,
  table_name text,
  record_id text,
  detail jsonb not null default '{}'::jsonb,
  prev_hash text not null default '',
  hash text not null default '',
  unique (user_id, seq)
);
create index if not exists audit_journal_user_idx on public.audit_journal (user_id, seq);

create table if not exists public.clotures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date_fin date not null,
  libelle text,
  nb_factures int not null default 0,
  nb_paiements int not null default 0,
  total_ttc numeric not null default 0,
  total_encaisse numeric not null default 0,
  empreinte text,
  created_at timestamptz not null default now(),
  unique (user_id, date_fin)
);

alter table public.audit_journal enable row level security;
alter table public.clotures enable row level security;
drop policy if exists journal_lecture on public.audit_journal;
create policy journal_lecture on public.audit_journal for select using (user_id = auth.uid());
drop policy if exists clotures_lecture on public.clotures;
create policy clotures_lecture on public.clotures for select using (user_id = auth.uid());
-- L'écriture passe uniquement par les fonctions ci-dessous
revoke insert, update, delete on public.audit_journal from anon, authenticated;
revoke insert, update, delete on public.clotures from anon, authenticated;

-- Hash chaîné : chaque ligne contient l'empreinte de la précédente
create or replace function public.audit_hash(p_user uuid, p_seq bigint, p_at timestamptz, p_ev text, p_table text, p_rec text, p_detail jsonb, p_prev text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|', p_user::text, p_seq::text,
    to_char(p_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'), p_ev, coalesce(p_table, ''), coalesce(p_rec, ''), p_detail::text, p_prev), 'utf8')), 'hex')
$$;

create or replace function public.audit_before_insert()
returns trigger language plpgsql as $$
declare v_prev text; v_seq bigint;
begin
  perform pg_advisory_xact_lock(hashtext('audit:' || new.user_id::text));
  select seq, hash into v_seq, v_prev from public.audit_journal where user_id = new.user_id order by seq desc limit 1;
  new.seq := coalesce(v_seq, 0) + 1;
  new.prev_hash := coalesce(v_prev, '');
  new.at := clock_timestamp();
  new.hash := public.audit_hash(new.user_id, new.seq, new.at, new.evenement, new.table_name, new.record_id, new.detail, new.prev_hash);
  return new;
end $$;
drop trigger if exists audit_before_insert on public.audit_journal;
create trigger audit_before_insert before insert on public.audit_journal for each row execute function public.audit_before_insert();

create or replace function public.audit_immuable()
returns trigger language plpgsql as $$
begin
  raise exception 'Le journal d''audit est inaltérable : aucune ligne ne peut être modifiée ni supprimée.';
end $$;
drop trigger if exists audit_no_update on public.audit_journal;
create trigger audit_no_update before update or delete on public.audit_journal for each row execute function public.audit_immuable();
drop trigger if exists audit_no_truncate on public.audit_journal;
create trigger audit_no_truncate before truncate on public.audit_journal for each statement execute function public.audit_immuable();

-- Écriture dans le journal (interne)
create or replace function public.audit_log(p_user uuid, p_ev text, p_table text, p_rec text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.audit_journal (user_id, seq, evenement, table_name, record_id, detail)
  values (p_user, 0, p_ev, p_table, p_rec, coalesce(p_detail, '{}'::jsonb));
end $$;
revoke all on function public.audit_log(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Événements de l'application (connexion, export, impression…)
create or replace function public.journal_ajouter(p_ev text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  perform public.audit_log(auth.uid(), left(p_ev, 60), 'app', null, p_detail);
end $$;
grant execute on function public.journal_ajouter(text, jsonb) to authenticated;

-- Vérification de la chaîne : renvoie ok, nombre de lignes, première ligne en défaut
create or replace function public.journal_verifier()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_prev text := ''; v_n bigint := 0; v_exp bigint := 0; v_ko bigint := null; v_motif text;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  for r in select * from public.audit_journal where user_id = auth.uid() order by seq loop
    v_n := v_n + 1; v_exp := v_exp + 1;
    if r.seq <> v_exp then v_ko := r.seq; v_motif := 'Une ligne manque dans la suite du journal.'; exit; end if;
    if r.prev_hash <> v_prev then v_ko := r.seq; v_motif := 'Le lien avec la ligne précédente est rompu.'; exit; end if;
    if r.hash <> public.audit_hash(r.user_id, r.seq, r.at, r.evenement, r.table_name, r.record_id, r.detail, r.prev_hash) then
      v_ko := r.seq; v_motif := 'Le contenu de la ligne a été modifié.'; exit;
    end if;
    v_prev := r.hash;
  end loop;
  return jsonb_build_object('ok', v_ko is null, 'nb', v_n, 'premier_defaut', v_ko, 'motif', v_motif, 'dernier_hash', v_prev, 'verifie_le', now());
end $$;
grant execute on function public.journal_verifier() to authenticated;

-- ---- Verrouillage des factures émises ----
create or replace function public.derniere_cloture(p_user uuid)
returns date language sql stable security definer set search_path = public as $$
  select max(date_fin) from public.clotures where user_id = p_user
$$;
revoke all on function public.derniere_cloture(uuid) from public, anon, authenticated;

create or replace function public.facture_garde()
returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
  protege text[] := array['numero','client_id','chantier_id','date_emission','echeance','notes','objet','titre','montant_ht','montant_tva','montant_ttc','remise','tva_taux','user_id'];
begin
  if tg_op = 'DELETE' then
    if o->>'statut' <> 'Brouillon' then
      raise exception 'Une facture émise ne peut pas être supprimée. Créez un avoir pour la corriger.';
    end if;
    perform public.audit_log((o->>'user_id')::uuid, 'facture_supprimee_brouillon', 'factures', o->>'id', jsonb_build_object('numero', o->>'numero'));
    return old;
  end if;
  if o->>'statut' = 'Brouillon' then return new; end if;
  foreach k in array protege loop
    if o ? k and (o->k) is distinct from (n->k) then
      raise exception 'Cette facture est émise : le champ « % » ne peut plus être modifié. Créez un avoir puis une nouvelle facture.', k;
    end if;
  end loop;
  if n->>'statut' = 'Brouillon' then raise exception 'Une facture émise ne peut pas redevenir un brouillon.'; end if;
  return new;
end $$;
drop trigger if exists facture_garde on public.factures;
create trigger facture_garde before update or delete on public.factures for each row execute function public.facture_garde();

create or replace function public.facture_ligne_garde()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fid uuid; v_st text;
begin
  v_fid := coalesce((to_jsonb(new)->>'facture_id')::uuid, (to_jsonb(old)->>'facture_id')::uuid);
  select statut into v_st from public.factures where id = v_fid;
  if v_st is not null and v_st <> 'Brouillon' then
    raise exception 'Cette facture est émise : ses lignes ne peuvent plus être modifiées. Créez un avoir.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists facture_ligne_garde on public.factures_lignes;
create trigger facture_ligne_garde before insert or update or delete on public.factures_lignes for each row execute function public.facture_ligne_garde();

-- ---- Traçabilité des factures et des paiements ----
create or replace function public.audit_facture()
returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end; n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end; v_ev text;
begin
  if tg_op = 'INSERT' then
    perform public.audit_log((n->>'user_id')::uuid, 'facture_creee', 'factures', n->>'id', jsonb_build_object('numero', n->>'numero', 'statut', n->>'statut'));
  elsif tg_op = 'UPDATE' and (o->>'statut') is distinct from (n->>'statut') then
    v_ev := case when o->>'statut' = 'Brouillon' then 'facture_emise' when n->>'statut' = 'Annulée' then 'facture_annulee' else 'facture_statut' end;
    perform public.audit_log((n->>'user_id')::uuid, v_ev, 'factures', n->>'id',
      jsonb_build_object('numero', n->>'numero', 'de', o->>'statut', 'vers', n->>'statut', 'date_emission', n->>'date_emission', 'client_id', n->>'client_id',
        'montant_ht', n->>'montant_ht', 'montant_ttc', n->>'montant_ttc'));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists audit_facture on public.factures;
create trigger audit_facture after insert or update on public.factures for each row execute function public.audit_facture();

create or replace function public.audit_paiement()
returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end; n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  d jsonb := coalesce(n, o); v_cl date;
begin
  v_cl := public.derniere_cloture((d->>'user_id')::uuid);
  if v_cl is not null and nullif(d->>'date_paiement', '') is not null and (d->>'date_paiement')::date <= v_cl then
    raise exception 'La période du % est clôturée : ce paiement ne peut plus être ajouté, modifié ou supprimé. Saisissez une écriture de régularisation à une date postérieure.', to_char(v_cl, 'DD/MM/YYYY');
  end if;
  perform public.audit_log((d->>'user_id')::uuid,
    case tg_op when 'INSERT' then 'paiement_enregistre' when 'UPDATE' then 'paiement_modifie' else 'paiement_supprime' end,
    'paiements', d->>'id', jsonb_build_object('avant', o, 'apres', n));
  return coalesce(new, old);
end $$;
drop trigger if exists audit_paiement on public.paiements;
create trigger audit_paiement before insert or update or delete on public.paiements for each row execute function public.audit_paiement();

-- ---- Clôture de période ----
create or replace function public.cloturer_periode(p_date date, p_libelle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_u uuid := auth.uid(); v_nf int; v_np int; v_ttc numeric := 0; v_enc numeric := 0; v_last text; v_emp text; v_prev date;
begin
  if v_u is null then raise exception 'Connexion requise.'; end if;
  if p_date is null or p_date > current_date then raise exception 'La date de clôture ne peut pas être dans le futur.'; end if;
  v_prev := public.derniere_cloture(v_u);
  if v_prev is not null and p_date <= v_prev then raise exception 'Une clôture existe déjà jusqu''au %.', to_char(v_prev, 'DD/MM/YYYY'); end if;
  select count(*) into v_nf from public.factures where user_id = v_u and statut <> 'Brouillon' and date_emission <= p_date;
  select count(*), coalesce(sum(montant), 0) into v_np, v_enc from public.paiements where user_id = v_u and date_paiement <= p_date;
  select coalesce(sum(montant_ttc), 0) into v_ttc from public.v_factures where user_id = v_u and statut <> 'Brouillon' and date_emission <= p_date;
  select hash into v_last from public.audit_journal where user_id = v_u order by seq desc limit 1;
  v_emp := encode(sha256(convert_to(concat_ws('|', v_u::text, p_date::text, v_nf::text, v_np::text, v_ttc::text, v_enc::text, coalesce(v_last, '')), 'utf8')), 'hex');
  insert into public.clotures (user_id, date_fin, libelle, nb_factures, nb_paiements, total_ttc, total_encaisse, empreinte)
  values (v_u, p_date, p_libelle, v_nf, v_np, v_ttc, v_enc, v_emp);
  perform public.audit_log(v_u, 'cloture_periode', 'clotures', p_date::text, jsonb_build_object('date_fin', p_date, 'factures', v_nf, 'paiements', v_np, 'total_ttc', v_ttc, 'total_encaisse', v_enc, 'empreinte', v_emp));
  return jsonb_build_object('date_fin', p_date, 'empreinte', v_emp);
end $$;
grant execute on function public.cloturer_periode(date, text) to authenticated;

-- ============================================================
-- 3. Mails types, Gmail, historique
-- ============================================================
create table if not exists public.mail_modeles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  nom text not null,
  sujet text not null default '',
  corps text not null default '',
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, code)
);

create table if not exists public.gmail_connexions (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  statut text not null default 'Active' check (statut in ('Active','Erreur')),
  derniere_synchro timestamptz,
  erreur text,
  created_at timestamptz not null default now()
);

create table if not exists public.mails_envoyes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  direction text not null default 'sortant' check (direction in ('sortant','entrant')),
  gmail_id text,
  thread_id text,
  de text,
  a text,
  sujet text,
  extrait text,
  date_mail timestamptz not null default now(),
  client_id uuid references public.clients(id) on delete set null,
  doc_type text,
  doc_id uuid,
  pieces jsonb not null default '[]'::jsonb,
  lu boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists mails_gmail_uq on public.mails_envoyes (user_id, gmail_id) where gmail_id is not null;
create index if not exists mails_client_idx on public.mails_envoyes (user_id, client_id);

alter table public.mail_modeles enable row level security;
alter table public.gmail_connexions enable row level security;
alter table public.mails_envoyes enable row level security;

-- Les jetons Google ne sont jamais lisibles depuis le navigateur : seule la fonction serveur « gmail » les utilise
revoke all on public.gmail_connexions from anon, authenticated;
grant select (user_id, email, statut, derniere_synchro, erreur, created_at) on public.gmail_connexions to authenticated;
grant delete on public.gmail_connexions to authenticated;

-- ============================================================
-- 4. Notes
-- ============================================================
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titre text,
  contenu text not null default '',
  client_id uuid references public.clients(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  fournisseur_id uuid references public.fournisseurs(id) on delete set null,
  rappel_le date,
  fait boolean not null default false,
  epingle boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id, created_at desc);
alter table public.notes enable row level security;

-- ============================================================
-- 5. Procès-verbaux de réception
-- ============================================================
create table if not exists public.pv_reception (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero text,
  chantier_id uuid references public.chantiers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  date_reception date not null default current_date,
  type text not null default 'Sans réserve' check (type in ('Sans réserve','Avec réserves','Refusée')),
  lieu text,
  objet text,
  observations text,
  delai_levee date,
  statut text not null default 'Brouillon' check (statut in ('Brouillon','Envoyé','Signé','Réserves levées')),
  token uuid not null default gen_random_uuid() unique,
  pdf_path text,
  signataire_nom text,
  signature_client text,
  signe_at timestamptz,
  hash_pdf text,
  user_agent text,
  signature_ent text,
  chemin_pdf text,
  created_at timestamptz not null default now()
);
create table if not exists public.pv_reserves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pv_id uuid not null references public.pv_reception(id) on delete cascade,
  position int not null default 0,
  description text not null,
  localisation text,
  levee boolean not null default false,
  levee_le date
);
create index if not exists pv_reserves_pv_idx on public.pv_reserves (pv_id);
alter table public.pv_reception enable row level security;
alter table public.pv_reserves enable row level security;

do $$
declare t text;
begin
  foreach t in array array['mail_modeles','gmail_connexions','mails_envoyes','notes','pv_reception','pv_reserves'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own') then
      execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- Un PV signé ne se modifie plus (seuls le suivi des réserves et le statut restent libres)
create or replace function public.pv_garde()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.signe_at is not null then raise exception 'Un PV signé ne peut pas être supprimé.'; end if;
    return old;
  end if;
  if old.signe_at is not null and (
       new.date_reception is distinct from old.date_reception or new.type is distinct from old.type or new.observations is distinct from old.observations
    or new.chantier_id is distinct from old.chantier_id or new.signature_client is distinct from old.signature_client or new.signataire_nom is distinct from old.signataire_nom
    or new.objet is distinct from old.objet or new.lieu is distinct from old.lieu or new.numero is distinct from old.numero) then
    raise exception 'Ce procès-verbal est signé : il ne peut plus être modifié.';
  end if;
  return new;
end $$;
drop trigger if exists pv_garde on public.pv_reception;
create trigger pv_garde before update or delete on public.pv_reception for each row execute function public.pv_garde();

-- Page publique : lecture du PV par son jeton
create or replace function public.pv_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.pv_reception; e jsonb; c jsonb; ch jsonb; res jsonb;
begin
  select * into p from public.pv_reception where token = p_token and statut <> 'Brouillon';
  if not found then return null; end if;
  select jsonb_build_object('nom', nom, 'telephone', telephone, 'email', email, 'adresse', adresse, 'siret', siret) into e from public.entreprise where user_id = p.user_id;
  select jsonb_build_object('nom', nom) into c from public.clients where id = p.client_id;
  select jsonb_build_object('nom', nom, 'adresse', adresse) into ch from public.chantiers where id = p.chantier_id;
  select jsonb_build_object(
    'numero', p.numero, 'date_reception', p.date_reception, 'type', p.type, 'lieu', p.lieu, 'objet', p.objet, 'observations', p.observations,
    'delai_levee', p.delai_levee, 'statut', p.statut, 'signe_at', p.signe_at, 'signataire_nom', p.signataire_nom,
    'pdf_path', p.pdf_path, 'entreprise', coalesce(e, '{}'::jsonb), 'client', coalesce(c, '{}'::jsonb), 'chantier', coalesce(ch, '{}'::jsonb),
    'reserves', coalesce((select jsonb_agg(jsonb_build_object('description', r.description, 'localisation', r.localisation, 'levee', r.levee) order by r.position) from public.pv_reserves r where r.pv_id = p.id), '[]'::jsonb))
  into res;
  return res;
end $$;
grant execute on function public.pv_get(uuid) to anon, authenticated;

-- Page publique : signature du PV par le client
create or replace function public.pv_signer(p_token uuid, p_nom text, p_signature text, p_hash text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.pv_reception;
begin
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez votre nom pour signer.'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 400000 then
    raise exception 'La signature est invalide. Dessinez-la de nouveau.';
  end if;
  select * into p from public.pv_reception where token = p_token and statut <> 'Brouillon';
  if not found then raise exception 'Ce lien n''est pas valide.'; end if;
  if p.signe_at is not null then raise exception 'Ce procès-verbal est déjà signé.'; end if;
  update public.pv_reception set signataire_nom = left(trim(p_nom), 120), signature_client = p_signature, signe_at = now(),
    hash_pdf = left(coalesce(p_hash, ''), 128), user_agent = left(coalesce(p_ua, ''), 300),
    statut = 'Signé'
  where id = p.id;
  perform public.audit_log(p.user_id, 'pv_signe', 'pv_reception', p.id::text, jsonb_build_object('numero', p.numero, 'signataire', left(trim(p_nom), 120), 'hash_pdf', left(coalesce(p_hash, ''), 128)));
  begin
    insert into public.notifications (user_id, type, titre, message)
    values (p.user_id, 'paiement', 'PV de réception signé', coalesce(p.numero, 'PV') || ' signé par ' || left(trim(p_nom), 120));
  exception when others then null;
  end;
end $$;
grant execute on function public.pv_signer(uuid, text, text, text, text) to anon, authenticated;
