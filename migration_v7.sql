-- Pilot · migration v7 : bibliothèque d'ouvrages, signature électronique, facture électronique, connexion bancaire
-- À exécuter une fois dans Supabase > SQL Editor. Idempotent (peut être relancé sans risque).
-- Prérequis : migrations v4, v5 et v6 déjà exécutées.

-- 1. Bibliothèque d'ouvrages (prix et temps de pose)
create table if not exists public.ouvrages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text,
  corps_etat text not null default 'Divers',
  designation text not null,
  unite text not null default 'u',
  prix_ht numeric not null default 0,
  temps_pose_h numeric not null default 0,      -- heures de pose par unité
  part_mo numeric not null default 0,           -- part main d'œuvre du prix, en %
  taux_tva numeric not null default 20,
  source text not null default 'Perso',
  created_at timestamptz not null default now()
);
create index if not exists ouvrages_user_idx on public.ouvrages (user_id);
create index if not exists ouvrages_corps_idx on public.ouvrages (user_id, corps_etat);
create index if not exists ouvrages_code_idx on public.ouvrages (user_id, code);
create extension if not exists pg_trgm;
create index if not exists ouvrages_des_trgm on public.ouvrages using gin (designation gin_trgm_ops);

-- Liste des corps d'état de la bibliothèque, avec le nombre d'ouvrages
create or replace function public.ouvrages_corps()
returns table (corps_etat text, nb bigint)
language sql stable
as $$ select o.corps_etat, count(*) from public.ouvrages o where o.user_id = auth.uid() group by o.corps_etat order by o.corps_etat $$;
grant execute on function public.ouvrages_corps() to authenticated;

-- 2. Informations client pour la facture électronique (SIRET, TVA intracommunautaire)
alter table public.clients add column if not exists siret text;
alter table public.clients add column if not exists tva_intracom text;

-- 3. Réglages facture électronique de l'entreprise
alter table public.entreprise add column if not exists pa_nom text;
alter table public.entreprise add column if not exists categorie_operation text default 'Prestation de services';
alter table public.entreprise add column if not exists tva_sur_debits boolean default false;

-- 4. Factures électroniques générées
create table if not exists public.factures_electroniques (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  facture_id uuid not null references public.factures(id) on delete cascade,
  profil text not null default 'EN 16931',
  statut text not null default 'Générée'
    check (statut in ('Générée','Transmise','Acceptée','Refusée','Encaissée')),
  plateforme text,
  reference_pa text,
  categorie_operation text,
  hash text,
  chemin_pdf text,
  chemin_xml text,
  erreur text,
  transmis_at timestamptz,
  created_at timestamptz not null default now(),
  unique (facture_id)
);
create index if not exists fe_user_idx on public.factures_electroniques (user_id);

-- 5. Signatures électroniques de devis (piste d'audit)
create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  partage_token uuid not null,
  devis_id uuid,
  nom text not null,
  signature text not null,        -- image PNG (data URL) dessinée par le client
  hash_pdf text,                  -- empreinte SHA-256 du PDF signé
  user_agent text,
  signed_at timestamptz not null default now(),
  chemin_pdf text,                -- PDF signé archivé (bucket documents)
  unique (partage_token)
);
create index if not exists signatures_user_idx on public.signatures (user_id);

-- 6. Connexions bancaires (agrégateur PSD2 via Edge Function) + liens vers les comptes
create table if not exists public.banque_connexions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fournisseur text not null default 'enablebanking',
  banque text not null,
  pays text not null default 'FR',
  session_id text,
  statut text not null default 'En attente' check (statut in ('En attente','Active','Expirée','Erreur')),
  valide_jusqu_au timestamptz,
  derniere_synchro timestamptz,
  erreur text,
  created_at timestamptz not null default now()
);
create index if not exists banque_cx_user_idx on public.banque_connexions (user_id);
alter table public.banque_comptes add column if not exists connexion_id uuid references public.banque_connexions(id) on delete set null;
alter table public.banque_comptes add column if not exists externe_id text;

-- 7. Sécurité (RLS)
alter table public.ouvrages enable row level security;
alter table public.factures_electroniques enable row level security;
alter table public.signatures enable row level security;
alter table public.banque_connexions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ouvrages','factures_electroniques','signatures','banque_connexions'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own') then
      execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- 8. Signature par le client depuis le lien public : accepte le devis ET garde la preuve de signature
create or replace function public.partage_signer(p_token uuid, p_nom text, p_signature text, p_hash text, p_ua text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare j jsonb; v_user uuid; v_doc uuid;
begin
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez votre nom pour signer.'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 400000 then
    raise exception 'La signature est invalide. Dessinez-la de nouveau.';
  end if;
  select to_jsonb(p) into j from public.partages p where p.token = p_token;
  if j is null then raise exception 'Ce lien n''est pas valide.'; end if;
  if j->>'type' <> 'devis' then raise exception 'Seuls les devis peuvent être signés.'; end if;
  v_doc := (j->>'doc_id')::uuid;
  v_user := nullif(j->>'user_id', '')::uuid;
  if v_user is null then select d.user_id into v_user from public.devis d where d.id = v_doc; end if;
  if exists (select 1 from public.signatures s where s.partage_token = p_token) then
    raise exception 'Ce devis est déjà signé.';
  end if;
  perform public.partage_accepter(p_token, left(trim(p_nom), 120));
  insert into public.signatures (user_id, partage_token, devis_id, nom, signature, hash_pdf, user_agent)
  values (v_user, p_token, v_doc, left(trim(p_nom), 120), p_signature, left(coalesce(p_hash, ''), 128), left(coalesce(p_ua, ''), 300));
end $$;
grant execute on function public.partage_signer(uuid, text, text, text, text) to anon, authenticated;
