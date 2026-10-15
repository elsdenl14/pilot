-- Pilot · migration v8 : facturation BTP complète
-- (acomptes, situations, situations détaillées, factures finales, retenues de garantie, primes énergétiques,
--  comptes prorata, postes libres, escomptes, avoirs)
-- À exécuter une fois dans Supabase > SQL Editor. Idempotent. Prérequis : migrations v4 à v7.

-- 1. Informations propres à chaque facture (table à part : n'abîme ni la table factures ni la vue v_factures)
create table if not exists public.factures_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  facture_id uuid not null references public.factures(id) on delete cascade,
  nature text not null default 'Facture'
    check (nature in ('Facture','Acompte','Situation','Situation détaillée','Finale','Avoir')),
  devis_id uuid references public.devis(id) on delete set null,      -- devis (marché) auquel la facture se rattache
  parent_id uuid references public.factures(id) on delete set null,  -- avoir : facture d'origine
  situation_no integer,
  marche_ht numeric,                 -- montant HT du marché de référence
  acompte_pct numeric,               -- acompte : pourcentage demandé
  avancement jsonb,                  -- situations : lignes d'avancement (marché, % précédent, % cumulé)
  deduit jsonb,                      -- facture finale : factures précédentes déduites
  motif text,                        -- avoir : motif
  retenue_pct numeric not null default 0,
  retenue_caution boolean not null default false,  -- retenue remplacée par une caution bancaire
  retenue_date date,                 -- date de libération prévue
  retenue_liberee_le date,           -- date de libération effective
  prime_montant numeric not null default 0,
  prime_libelle text,
  prime_recue_le date,
  prorata_pct numeric not null default 0,
  prorata_montant numeric not null default 0,
  escompte_pct numeric not null default 0,
  escompte_jours integer not null default 0,
  created_at timestamptz not null default now(),
  unique (facture_id)
);
create index if not exists fd_user_idx on public.factures_details (user_id);
create index if not exists fd_devis_idx on public.factures_details (devis_id);
alter table public.factures_details enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='factures_details' and policyname='own') then
    create policy own on public.factures_details for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- 2. Lignes de facture : nature (normale, poste libre, déduction d'une facture précédente) et facture déduite
alter table public.factures_lignes add column if not exists nature text not null default 'normale';
alter table public.factures_lignes add column if not exists ref_facture_id uuid;

-- 3. Montants négatifs : nécessaires aux avoirs, aux remises et aux déductions d'acomptes.
--    On retire UNIQUEMENT les contraintes de type « montant >= 0 » qui bloqueraient ces cas, sur les lignes et les factures.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.factures_lignes'::regclass, 'public.factures'::regclass)
      and pg_get_constraintdef(c.oid) ~* '(quantite|prix_unitaire_ht|montant_ht|montant_tva|montant_ttc)\s*(>|>=)\s*\(?0'
  loop
    raise notice 'Contrainte retirée sur % : % (%)', r.tbl, r.conname, r.def;
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;
