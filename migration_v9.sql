-- Pilot · migration v9 : règlements clients
-- (RIB, paiement en ligne, page client, suivi et relances, crédits clients, trop-perçus, chèques et remises en banque)
-- À exécuter une fois dans Supabase > SQL Editor. Idempotent : peut être relancé sans risque.
-- Prérequis : migration_v4 à v7 déjà exécutées (v6 pour le lien avec la banque).

-- 1. RIB de l'entreprise (comptes sur lesquels vos clients vous paient)
create table if not exists public.ribs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  libelle text not null default 'Compte principal',
  titulaire text,
  banque text,
  iban text not null,
  bic text,
  par_defaut boolean not null default false,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ribs_user_idx on public.ribs (user_id);
create unique index if not exists ribs_un_defaut on public.ribs (user_id) where par_defaut;

-- 2. RIB des clients (remboursements, prélèvement SEPA)
create table if not exists public.client_ribs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  titulaire text,
  iban text not null,
  bic text,
  mandat_ref text,
  mandat_date date,
  created_at timestamptz not null default now()
);
create index if not exists client_ribs_client_idx on public.client_ribs (client_id);

-- 3. Remises de chèques (bordereaux de dépôt en banque)
create table if not exists public.remises_cheques (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero text not null,
  date_remise date not null default current_date,
  compte_id uuid references public.banque_comptes(id) on delete set null,
  statut text not null default 'Déposée' check (statut in ('Déposée','Créditée')),
  date_credit date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists remises_user_idx on public.remises_cheques (user_id);

-- 4. Chèques reçus
create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  facture_id uuid references public.factures(id) on delete set null,
  paiement_id uuid references public.paiements(id) on delete set null,
  remise_id uuid references public.remises_cheques(id) on delete set null,
  numero text,
  banque text,
  emetteur text,
  montant numeric not null check (montant > 0),
  date_cheque date,
  date_reception date not null default current_date,
  statut text not null default 'Reçu' check (statut in ('Reçu','Remis','Encaissé','Impayé')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists cheques_user_idx on public.cheques (user_id);
create index if not exists cheques_remise_idx on public.cheques (remise_id);

-- 5. Crédits clients : trop-perçus, avances, avoirs, utilisations, remboursements
--    montant > 0 : le client a un crédit ; montant < 0 : le crédit est utilisé ou remboursé.
create table if not exists public.client_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  montant numeric not null check (montant <> 0),
  type text not null check (type in ('Trop-perçu','Avance','Avoir','Ajustement','Utilisation','Remboursement')),
  facture_id uuid references public.factures(id) on delete set null,
  paiement_id uuid references public.paiements(id) on delete set null,
  cheque_id uuid references public.cheques(id) on delete set null,
  date_op date not null default current_date,
  mode text,
  reference text,
  motif text,
  created_at timestamptz not null default now()
);
create index if not exists client_credits_client_idx on public.client_credits (client_id);
create index if not exists client_credits_user_idx on public.client_credits (user_id);

-- 6. Suivi des règlements : relances envoyées, promesses de paiement, échanges, litiges
create table if not exists public.reglement_suivi (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  facture_id uuid not null references public.factures(id) on delete cascade,
  type text not null check (type in ('Relance','Promesse','Virement annoncé','Appel','Note','Litige')),
  niveau int,
  canal text,
  date_op date not null default current_date,
  date_promesse date,
  montant numeric,
  note text,
  source text not null default 'pilot',
  created_at timestamptz not null default now()
);
create index if not exists reglement_suivi_facture_idx on public.reglement_suivi (facture_id);
create index if not exists reglement_suivi_user_idx on public.reglement_suivi (user_id);

-- 7. Paiements en ligne (rempli par les fonctions serveur, voir supabase/functions)
create table if not exists public.paiement_liens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  facture_id uuid not null references public.factures(id) on delete cascade,
  fournisseur text not null default 'stripe',
  ref_externe text,
  montant numeric not null,
  statut text not null default 'En attente' check (statut in ('En attente','Payé','Expiré','Échoué')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists paiement_liens_facture_idx on public.paiement_liens (facture_id);

-- 8. Réglages du paiement en ligne (dans la fiche entreprise)
alter table public.entreprise add column if not exists paiement_en_ligne text;       -- null | 'lien' | 'stripe'
alter table public.entreprise add column if not exists paiement_lien_modele text;    -- ex. https://paypal.me/monentreprise/{montant}

-- 9. Sécurité (RLS)
do $$
declare t text;
begin
  foreach t in array array['ribs','client_ribs','remises_cheques','cheques','client_credits','reglement_suivi','paiement_liens'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own') then
      execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- 10. Nouveaux modes de règlement : on retire l'ancienne contrainte éventuelle sur paiements.mode
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.paiements'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%mode%'
  loop
    execute format('alter table public.paiements drop constraint %I', c.conname);
  end loop;
exception when others then null;
end $$;

-- 11. Page client : tout ce qu'il faut pour régler une facture (jeton = lien privé, sans compte)
create or replace function public.partage_reglement(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record; f record; e record; uid_ uuid; res jsonb;
begin
  select * into p from partages where token = p_token;
  if not found or p.type <> 'facture' then return null; end if;
  select * into f from v_factures where id = p.doc_id;
  if not found then return null; end if;
  select user_id into uid_ from factures where id = p.doc_id;
  select * into e from entreprise where user_id = uid_;
  res := jsonb_build_object(
    'numero', f.numero, 'montant_ttc', f.montant_ttc, 'paye', f.paye, 'reste', f.reste,
    'statut', f.statut, 'statut_affiche', f.statut_affiche, 'echeance', f.echeance,
    'beneficiaire', coalesce(e.nom, ''),
    'adresse', coalesce(e.adresse, ''),
    'en_ligne', coalesce(e.paiement_en_ligne, ''),
    'lien_modele', case when e.paiement_en_ligne = 'lien' then coalesce(e.paiement_lien_modele, '') else '' end,
    'ribs', coalesce((select jsonb_agg(jsonb_build_object('libelle', r.libelle, 'titulaire', r.titulaire, 'banque', r.banque, 'iban', r.iban, 'bic', r.bic) order by r.par_defaut desc, r.created_at)
                      from ribs r where r.user_id = uid_ and r.actif), '[]'::jsonb),
    'paiements', coalesce((select jsonb_agg(jsonb_build_object('date', x.date_paiement, 'montant', x.montant, 'mode', x.mode) order by x.date_paiement)
                           from paiements x where x.facture_id = p.doc_id), '[]'::jsonb),
    'echeances', coalesce((select jsonb_agg(jsonb_build_object('libelle', y.libelle, 'date', y.date_echeance, 'montant', y.montant) order by y.position)
                           from facture_echeances y where y.facture_id = p.doc_id), '[]'::jsonb),
    'signalements', coalesce((select jsonb_agg(jsonb_build_object('type', s.type, 'date', s.date_op, 'date_promesse', s.date_promesse) order by s.created_at desc)
                              from reglement_suivi s where s.facture_id = p.doc_id and s.source = 'client'), '[]'::jsonb)
  );
  return res;
end $$;
grant execute on function public.partage_reglement(uuid) to anon, authenticated;

-- 12. Page client : « j'ai payé » / « je paierai le… » (prévient l'entreprise)
create or replace function public.partage_signaler(p_token uuid, p_type text, p_date date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p record; f record; uid_ uuid; lbl text;
begin
  if p_type not in ('Virement annoncé','Promesse') then raise exception 'Action inconnue'; end if;
  select * into p from partages where token = p_token;
  if not found or p.type <> 'facture' then raise exception 'Lien invalide'; end if;
  select user_id into uid_ from factures where id = p.doc_id;
  select * into f from v_factures where id = p.doc_id;
  if exists (select 1 from reglement_suivi where facture_id = p.doc_id and source = 'client' and type = p_type and created_at > now() - interval '1 hour') then
    return; -- évite les doublons
  end if;
  if p_type = 'Promesse' and (p_date is null or p_date < current_date or p_date > current_date + 120) then
    raise exception 'Choisissez une date à venir (dans les 4 mois).';
  end if;
  insert into reglement_suivi (user_id, facture_id, type, date_op, date_promesse, montant, note, source)
  values (uid_, p.doc_id, p_type, current_date, case when p_type = 'Promesse' then p_date end, f.reste, left(coalesce(p_note, ''), 500), 'client');
  lbl := case when p_type = 'Promesse' then 'promet de payer le ' || to_char(p_date, 'DD/MM/YYYY') else 'annonce avoir effectué le virement' end;
  begin
    insert into notifications (user_id, type, titre, message)
    values (uid_, 'paiement', 'Facture ' || f.numero || ' : ' || f.client_nom, f.client_nom || ' ' || lbl || '.');
  exception when others then null;
  end;
end $$;
grant execute on function public.partage_signaler(uuid, text, date, text) to anon, authenticated;
