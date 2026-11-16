-- Pilot v16 : Sous-traitance et collaboration externe / Sécurité, ergonomie et pilotage
-- À lancer une seule fois dans Supabase > SQL Editor (peut être relancé sans risque). Les migrations v1 à v15 doivent être faites.

-- ============ 1. Préférences (accueil personnalisé, rôles, onglets) ============
create table if not exists public.prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cle text not null,
  valeur jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, cle)
);

-- ============ 2. Dossier administratif des sous-traitants ============
create table if not exists public.st_pieces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sous_traitant_id uuid not null references public.sous_traitants(id) on delete cascade,
  type text not null,                 -- Kbis, Attestation de vigilance URSSAF, Assurance décennale, ...
  libelle text,
  numero text,
  date_emission date,
  date_validite date,                 -- fin de validité (alertes)
  fichier text,                       -- chemin dans le stockage privé "documents"
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists st_pieces_st_idx on public.st_pieces (sous_traitant_id);

-- ============ 3. Situations de sous-traitants ============
create table if not exists public.st_situations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sous_traitant_id uuid not null references public.sous_traitants(id) on delete cascade,
  mission_id uuid references public.st_missions(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  numero text,
  date_situation date not null default current_date,
  periode text,
  cumul_ht numeric not null default 0,        -- montant cumulé annoncé par le sous-traitant
  precedent_ht numeric not null default 0,    -- cumul des situations précédentes
  montant_ht numeric not null default 0,      -- cumul - précédent
  tva_taux numeric not null default 20,
  autoliquidation boolean not null default false,
  tva_montant numeric not null default 0,
  montant_ttc numeric not null default 0,
  retenue_pct numeric not null default 0,
  retenue_eur numeric not null default 0,
  net_a_payer numeric not null default 0,
  statut text not null default 'Reçue' check (statut in ('Reçue','Vérifiée','Contestée','Payée')),
  depense_id uuid references public.depenses(id) on delete set null,
  fichier text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists st_situations_st_idx on public.st_situations (sous_traitant_id);
create index if not exists st_situations_ch_idx on public.st_situations (chantier_id);

-- ============ 4. Portail de validation architecte / maître d'œuvre ============
create table if not exists public.moe_partages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  source_type text not null default 'facture',    -- facture (situation) ou proforma
  source_id uuid,
  chantier_id uuid references public.chantiers(id) on delete set null,
  titre text not null,
  version int not null default 1,
  lignes jsonb not null default '[]'::jsonb,       -- instantané : [{label, marche, prev, cum, montant}]
  total_ht numeric not null default 0,
  dest_nom text,
  dest_email text,
  message text,
  expire_at timestamptz not null default (now() + interval '30 days'),
  statut text not null default 'En attente'
    check (statut in ('En attente','Commentée','Validée','Validée avec réserves','Refusée','Révoquée')),
  avis jsonb not null default '[]'::jsonb,         -- [{i, ok, c}]
  commentaire text,
  decide_par text,
  decide_at timestamptz,
  vu_at timestamptz,
  nb_vues int not null default 0,
  historique jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists moe_partages_user_idx on public.moe_partages (user_id);

-- ============ 5. Offres de sous-traitance et candidatures ============
create table if not exists public.st_offres (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  titre text not null,
  metier text,
  chantier_id uuid references public.chantiers(id) on delete set null,
  lieu text,
  description text,
  date_debut date,
  duree text,
  budget_ht numeric,
  budget_visible boolean not null default false,
  date_limite date,
  publie boolean not null default false,
  statut text not null default 'Ouverte' check (statut in ('Ouverte','Clôturée','Attribuée')),
  created_at timestamptz not null default now()
);
create table if not exists public.st_candidatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offre_id uuid not null references public.st_offres(id) on delete cascade,
  nom text not null,
  siret text,
  contact text,
  email text,
  telephone text,
  metier text,
  prix_ht numeric,
  delai_jours int,
  references_txt text,
  message text,
  assurance_ok boolean not null default false,    -- déclaratif : à contrôler sur pièces
  vigilance_ok boolean not null default false,    -- déclaratif : à contrôler sur pièces
  statut text not null default 'Reçue' check (statut in ('Reçue','Présélectionnée','Retenue','Refusée')),
  note int,
  sous_traitant_id uuid references public.sous_traitants(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists st_cand_offre_idx on public.st_candidatures (offre_id);

-- ============ 6. Suivi de consultation des liens partagés ============
alter table public.partages add column if not exists expire_at timestamptz;
alter table public.partages add column if not exists revoque_at timestamptz;
alter table public.partages add column if not exists nb_vues int not null default 0;
alter table public.partages add column if not exists derniere_vue_at timestamptz;
create table if not exists public.partage_vues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token uuid not null,
  vu_at timestamptz not null default now(),
  ua text
);
create index if not exists partage_vues_token_idx on public.partage_vues (token);

-- ============ 7. Protection contre la fraude au changement de RIB ============
create table if not exists public.rib_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,               -- entreprise, rib, fournisseur
  ref_id text,
  libelle text,
  operation text not null,            -- création, modification, suppression
  ancien text,
  nouveau text,
  auteur_uid uuid default auth.uid(),
  auteur_email text,
  motif text,                         -- renseigné par l'application après contrôle
  verifie text,                       -- méthode de vérification déclarée
  created_at timestamptz not null default now()
);
create index if not exists rib_journal_user_idx on public.rib_journal (user_id, created_at desc);

create or replace function public.rib_trace() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; uid_ uuid; lbl text; src text; oi text; ni text; op text;
begin
  o := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  uid_ := coalesce((n->>'user_id')::uuid, (o->>'user_id')::uuid);
  src := case tg_table_name when 'entreprise' then 'entreprise' when 'ribs' then 'rib' else 'fournisseur' end;
  oi := upper(regexp_replace(coalesce(o->>'iban', ''), '\s', '', 'g'));
  ni := upper(regexp_replace(coalesce(n->>'iban', ''), '\s', '', 'g'));
  if tg_op = 'UPDATE' and oi = ni and coalesce(o->>'bic','') = coalesce(n->>'bic','') then return new; end if;
  if tg_op = 'INSERT' and ni = '' then return new; end if;
  if tg_op = 'UPDATE' and oi = '' and ni = '' then return new; end if;
  op := case tg_op when 'INSERT' then 'création' when 'DELETE' then 'suppression' else 'modification' end;
  lbl := coalesce(n->>'nom', o->>'nom', n->>'libelle', o->>'libelle', n->>'titulaire', o->>'titulaire', '');
  insert into public.rib_journal (user_id, source, ref_id, libelle, operation, ancien, nouveau, auteur_email)
  values (uid_, src, coalesce(n->>'id', o->>'id', n->>'user_id'), lbl, op,
          nullif(oi || case when coalesce(o->>'bic','') <> '' then ' / ' || (o->>'bic') else '' end, ''),
          nullif(ni || case when coalesce(n->>'bic','') <> '' then ' / ' || (n->>'bic') else '' end, ''),
          auth.jwt() ->> 'email');
  return coalesce(new, old);
end $$;

drop trigger if exists trg_rib_trace on public.entreprise;
create trigger trg_rib_trace after update on public.entreprise for each row execute function public.rib_trace();
drop trigger if exists trg_rib_trace on public.ribs;
create trigger trg_rib_trace after insert or update or delete on public.ribs for each row execute function public.rib_trace();
drop trigger if exists trg_rib_trace on public.fournisseurs;
create trigger trg_rib_trace after insert or update or delete on public.fournisseurs for each row execute function public.rib_trace();

-- Le journal ne peut être ni supprimé ni réécrit : seuls le motif et la vérification peuvent être complétés.
create or replace function public.rib_journal_lock() returns trigger
language plpgsql as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.source <> old.source or new.operation <> old.operation
     or new.ancien is distinct from old.ancien or new.nouveau is distinct from old.nouveau or new.created_at <> old.created_at then
    raise exception 'Le journal des coordonnées bancaires est en lecture seule.';
  end if;
  return new;
end $$;
drop trigger if exists trg_rib_journal_lock on public.rib_journal;
create trigger trg_rib_journal_lock before update on public.rib_journal for each row execute function public.rib_journal_lock();

-- ============ 8. Sécurité d'accès (RLS) ============
do $$
declare t text;
begin
  foreach t in array array['prefs','st_pieces','st_situations','moe_partages','st_offres','st_candidatures','partage_vues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own on public.%I', t);
    execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
alter table public.rib_journal enable row level security;
drop policy if exists own_select on public.rib_journal;
create policy own_select on public.rib_journal for select using (user_id = auth.uid());
drop policy if exists own_update on public.rib_journal;
create policy own_update on public.rib_journal for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- volontairement aucune politique d'insertion ni de suppression : seul le déclencheur écrit, personne ne supprime.

-- ============ 9. Pages publiques (sans compte, par lien) ============
-- 9a. Consultation des liens devis / facture
create or replace function public.partage_vue(p_token uuid, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.partages;
begin
  select * into s from public.partages where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'raison', 'inconnu'); end if;
  if s.revoque_at is not null then return jsonb_build_object('ok', false, 'raison', 'revoque'); end if;
  if s.expire_at is not null and s.expire_at < now() then return jsonb_build_object('ok', false, 'raison', 'expire'); end if;
  if (select count(*) from public.partage_vues where token = p_token) < 500 then
    insert into public.partage_vues (user_id, token, ua) values (s.user_id, p_token, left(coalesce(p_ua, ''), 200));
  end if;
  update public.partages set nb_vues = nb_vues + 1, derniere_vue_at = now() where token = p_token;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.partage_vue(uuid, text) from public;
grant execute on function public.partage_vue(uuid, text) to anon, authenticated;

-- 9b. Portail du maître d'œuvre
create or replace function public.moe_get(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.moe_partages; e record;
begin
  select * into m from public.moe_partages where token = p_token;
  if not found or m.statut = 'Révoquée' then raise exception 'Ce lien n''est plus valide.'; end if;
  if m.expire_at < now() then raise exception 'Ce lien a expiré. Demandez-en un nouveau à l''entreprise.'; end if;
  update public.moe_partages set nb_vues = nb_vues + 1, vu_at = coalesce(vu_at, now()) where id = m.id;
  select nom, telephone, email into e from public.entreprise where user_id = m.user_id;
  return jsonb_build_object(
    'entreprise', jsonb_build_object('nom', e.nom, 'telephone', e.telephone, 'email', e.email),
    'titre', m.titre, 'version', m.version, 'lignes', m.lignes, 'total_ht', m.total_ht, 'message', m.message,
    'dest_nom', m.dest_nom, 'statut', m.statut, 'avis', m.avis, 'commentaire', m.commentaire,
    'decide_par', m.decide_par, 'decide_at', m.decide_at, 'expire_at', m.expire_at, 'historique', m.historique,
    'chantier', (select nom from public.chantiers where id = m.chantier_id));
end $$;

create or replace function public.moe_avis(p_token uuid, p_nom text, p_decision text, p_global text, p_avis jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m public.moe_partages; clean jsonb; ns text; n int;
begin
  select * into m from public.moe_partages where token = p_token;
  if not found or m.statut = 'Révoquée' then raise exception 'Ce lien n''est plus valide.'; end if;
  if m.expire_at < now() then raise exception 'Ce lien a expiré.'; end if;
  if m.statut not in ('En attente', 'Commentée') then raise exception 'Une décision a déjà été enregistrée pour cette version.'; end if;
  if p_decision not in ('Commentée', 'Validée', 'Validée avec réserves', 'Refusée') then raise exception 'Décision inconnue.'; end if;
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Indiquez votre nom.'; end if;
  if jsonb_typeof(coalesce(p_avis, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_avis, '[]'::jsonb)) > 500 then raise exception 'Avis invalide.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('i', (x->>'i')::int,
           'ok', case when x->>'ok' in ('true','false') then (x->>'ok')::boolean else null end,
           'c', left(coalesce(x->>'c', ''), 1000))), '[]'::jsonb)
    into clean from jsonb_array_elements(coalesce(p_avis, '[]'::jsonb)) x;
  ns := p_decision;
  update public.moe_partages set statut = ns, avis = clean, commentaire = left(coalesce(p_global, ''), 3000),
    decide_par = left(trim(p_nom), 120), decide_at = case when ns = 'Commentée' then null else now() end,
    historique = historique || jsonb_build_array(jsonb_build_object('at', now(), 'par', left(trim(p_nom), 120), 'decision', ns, 'version', m.version))
  where id = m.id;
  begin
    insert into public.notifications (user_id, type, titre, message)
    values (m.user_id, 'moe', 'Maître d''œuvre : ' || m.titre, left(trim(p_nom), 120) || ' : ' || lower(ns) || '.');
  exception when others then
    begin
      insert into public.notifications (user_id, type, titre, message)
      values (m.user_id, 'consultation', 'Maître d''œuvre : ' || m.titre, left(trim(p_nom), 120) || ' : ' || lower(ns) || '.');
    exception when others then null; end;
  end;
end $$;
revoke all on function public.moe_get(uuid) from public;
revoke all on function public.moe_avis(uuid, text, text, text, jsonb) from public;
grant execute on function public.moe_get(uuid) to anon, authenticated;
grant execute on function public.moe_avis(uuid, text, text, text, jsonb) to anon, authenticated;

-- 9c. Offres de sous-traitance
create or replace function public.offre_get(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.st_offres; e record;
begin
  select * into o from public.st_offres where token = p_token and publie;
  if not found then raise exception 'Cette offre n''existe pas ou n''est plus publiée.'; end if;
  if o.statut <> 'Ouverte' or (o.date_limite is not null and o.date_limite < current_date) then
    raise exception 'Cette offre est clôturée.';
  end if;
  select nom, telephone, email into e from public.entreprise where user_id = o.user_id;
  return jsonb_build_object('entreprise', jsonb_build_object('nom', e.nom, 'email', e.email),
    'titre', o.titre, 'metier', o.metier, 'lieu', o.lieu, 'description', o.description, 'date_debut', o.date_debut,
    'duree', o.duree, 'date_limite', o.date_limite, 'budget_ht', case when o.budget_visible then o.budget_ht end);
end $$;

create or replace function public.offre_candidater(p_token uuid, p_nom text, p_siret text, p_contact text, p_email text, p_telephone text,
  p_metier text, p_prix numeric, p_delai int, p_refs text, p_message text, p_assurance boolean, p_vigilance boolean, p_rgpd boolean, p_hp text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.st_offres;
begin
  select * into o from public.st_offres where token = p_token and publie and statut = 'Ouverte';
  if not found or (o.date_limite is not null and o.date_limite < current_date) then raise exception 'Cette offre est clôturée.'; end if;
  if coalesce(p_hp, '') <> '' then return; end if;   -- champ piège anti-robot
  if length(trim(coalesce(p_nom, ''))) < 2 then raise exception 'Indiquez le nom de votre entreprise.'; end if;
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse email invalide.'; end if;
  if not coalesce(p_rgpd, false) then raise exception 'Vous devez accepter que vos coordonnées soient conservées pour traiter votre candidature.'; end if;
  if p_prix is not null and (p_prix < 0 or p_prix > 100000000) then raise exception 'Prix invalide.'; end if;
  if (select count(*) from public.st_candidatures where offre_id = o.id) >= 100 then raise exception 'Le nombre maximal de candidatures est atteint.'; end if;
  if exists (select 1 from public.st_candidatures where offre_id = o.id and lower(email) = lower(trim(p_email))) then
    raise exception 'Une candidature avec cette adresse email a déjà été reçue.';
  end if;
  insert into public.st_candidatures (user_id, offre_id, nom, siret, contact, email, telephone, metier, prix_ht, delai_jours, references_txt, message, assurance_ok, vigilance_ok)
  values (o.user_id, o.id, left(trim(p_nom), 160), left(regexp_replace(coalesce(p_siret, ''), '\s', '', 'g'), 14), left(coalesce(p_contact, ''), 120), left(trim(p_email), 160),
          left(coalesce(p_telephone, ''), 30), left(coalesce(p_metier, ''), 80), p_prix, p_delai, left(coalesce(p_refs, ''), 2000), left(coalesce(p_message, ''), 3000),
          coalesce(p_assurance, false), coalesce(p_vigilance, false));
  begin
    insert into public.notifications (user_id, type, titre, message)
    values (o.user_id, 'candidature', 'Offre « ' || o.titre || ' »', 'Nouvelle candidature : ' || left(trim(p_nom), 160) || '.');
  exception when others then
    begin
      insert into public.notifications (user_id, type, titre, message)
      values (o.user_id, 'consultation', 'Offre « ' || o.titre || ' »', 'Nouvelle candidature : ' || left(trim(p_nom), 160) || '.');
    exception when others then null; end;
  end;
end $$;
revoke all on function public.offre_get(uuid) from public;
revoke all on function public.offre_candidater(uuid, text, text, text, text, text, text, numeric, int, text, text, boolean, boolean, boolean, text) from public;
grant execute on function public.offre_get(uuid) to anon, authenticated;
grant execute on function public.offre_candidater(uuid, text, text, text, text, text, text, numeric, int, text, text, boolean, boolean, boolean, text) to anon, authenticated;
