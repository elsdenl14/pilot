-- Pilot v14 : Appels d'offres, marchés complexes et facturation BTP avancée
-- À lancer une seule fois dans Supabase > SQL Editor (peut être relancé sans risque). Les migrations v1 à v13 doivent être faites.

-- 1. Lignes de devis : lots, sous-lots, tranches, référence de ligne dans un bordereau importé
alter table public.devis_lignes
  add column if not exists lot          text,
  add column if not exists sous_lot     text,
  add column if not exists tranche      text,                          -- nom de la tranche (vide = tranche ferme unique)
  add column if not exists tranche_cond boolean not null default false, -- tranche conditionnelle
  add column if not exists tranche_ok   boolean not null default false, -- tranche conditionnelle affermie
  add column if not exists marche_ref   text;                          -- n° de ligne dans le bordereau importé

alter table public.devis add column if not exists parent_id uuid references public.devis(id) on delete set null; -- avenant : devis d'origine

-- 2. Bordereaux importés (DPGF / DQE / BPU) : fichier d'origine et colonnes à réécrire à l'export
create table if not exists public.marche_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  devis_id uuid not null references public.devis(id) on delete cascade,
  format text not null default 'DPGF' check (format in ('DPGF','DQE','BPU')),
  nom_fichier text, fichier_path text, feuille text,
  col_qte int, col_pu int, col_tot int,
  created_at timestamptz not null default now(),
  unique (devis_id)
);

-- 3. Axes analytiques personnalisés
create table if not exists public.axes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  valeurs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.axe_valeurs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entite text not null check (entite in ('chantier','devis')),
  entite_id uuid not null,
  axe_id uuid not null references public.axes(id) on delete cascade,
  valeur text not null,
  unique (entite, entite_id, axe_id)
);

-- 4. Facturation : autoliquidation, récupération d'acompte, révision de prix
alter table public.factures_details
  add column if not exists autoliquidation boolean not null default false,
  add column if not exists acompte_deduit numeric not null default 0,   -- HT d'acompte déjà repris dans cette situation
  add column if not exists revision jsonb;                              -- détail du calcul de révision

-- 5. Factures proforma (documents non comptables, sans numéro de facture)
create table if not exists public.proformas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  devis_id uuid not null references public.devis(id) on delete cascade,
  numero text not null,
  date_emission date not null default current_date,
  pct numeric not null default 100,
  montant_ht numeric not null default 0,
  montant_ttc numeric not null default 0,
  lignes jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

-- 6. Révision de prix : paramètres du marché et valeurs d'indices
create table if not exists public.marche_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  devis_id uuid not null references public.devis(id) on delete cascade,
  indice text not null default 'BT01',
  i0_mois text not null,            -- mois de référence (AAAA-MM)
  i0_valeur numeric not null,
  part_fixe numeric not null default 0.15,
  unique (devis_id)
);
create table if not exists public.indices_valeurs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  indice text not null,
  mois text not null,
  valeur numeric not null,
  unique (user_id, indice, mois)
);

-- 7. Aides et primes (MaPrimeRénov', CEE…)
create table if not exists public.aides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  devis_id uuid not null references public.devis(id) on delete cascade,
  type text not null default 'MaPrimeRénov''',
  montant numeric not null default 0,
  statut text not null default 'Estimée' check (statut in ('Estimée','Validée','Perçue','Refusée')),
  reference text, notes text,
  created_at timestamptz not null default now()
);

-- 8. Attestations de TVA à taux réduit (pré-remplissage)
create table if not exists public.attestations_tva (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  devis_id uuid references public.devis(id) on delete set null,
  donnees jsonb not null default '{}'::jsonb,
  chemin_pdf text,
  created_at timestamptz not null default now()
);

-- 9. Déchets de chantier
create table if not exists public.dechets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  date_enlevement date not null default current_date,
  type text not null default 'Gravats inertes',
  quantite numeric not null default 0,
  unite text not null default 't',
  cout_ht numeric not null default 0,
  prestataire text, destination text, bsd_numero text, justificatif_path text,
  created_at timestamptz not null default now()
);

-- 10. Décompte général définitif
create table if not exists public.dgd (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  devis_id uuid not null references public.devis(id) on delete cascade,
  date_dgd date not null default current_date,
  donnees jsonb not null default '{}'::jsonb,
  statut text not null default 'Proposé' check (statut in ('Proposé','Accepté','Contesté')),
  created_at timestamptz not null default now()
);

-- 11. Sécurité : chaque utilisateur ne voit que ses lignes
do $$
declare t text;
begin
  foreach t in array array['marche_imports','axes','axe_valeurs','proformas','marche_revisions','indices_valeurs','aides','attestations_tva','dechets','dgd'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own on public.%I', t);
    execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_idx', t);
  end loop;
end $$;

-- 12. Totaux du devis : on ignore aussi les tranches conditionnelles non affermies
create or replace function public.trg_total_devis() returns trigger
language plpgsql as $$
declare d uuid := coalesce(new.devis_id, old.devis_id);
begin
  update public.devis set
    montant_ht  = coalesce((select sum(round(quantite * prix_unitaire_ht, 2))
                            from public.devis_lignes
                            where devis_id = d and type_ligne = 'normale' and (not est_option or option_choisie) and (not tranche_cond or tranche_ok)), 0),
    montant_tva = coalesce((select sum(round(round(quantite * prix_unitaire_ht, 2) * taux_tva / 100, 2))
                            from public.devis_lignes
                            where devis_id = d and type_ligne = 'normale' and (not est_option or option_choisie) and (not tranche_cond or tranche_ok)), 0)
  where id = d;
  return null;
end $$;

-- 13. Devis -> facture : sans images, options non retenues ni tranches non affermies
create or replace function public.devis_vers_facture(p_devis uuid)
returns uuid language plpgsql as $$
declare
  d public.devis;
  delai int;
  fid uuid;
begin
  select * into d from public.devis where id = p_devis;
  if not found then raise exception 'Devis introuvable'; end if;
  if exists (select 1 from public.factures where devis_id = p_devis and statut <> 'Annulée') then
    raise exception 'Ce devis a déjà été transformé en facture.';
  end if;
  select coalesce(delai_paiement_jours, 30) into delai from public.entreprise where user_id = auth.uid();

  insert into public.factures (client_id, chantier_id, devis_id, echeance, taux_tva, notes)
  values (d.client_id, d.chantier_id, d.id, current_date + coalesce(delai, 30), d.taux_tva, d.notes)
  returning id into fid;

  insert into public.factures_lignes (facture_id, position, designation, quantite, unite, prix_unitaire_ht, taux_tva)
  select fid, row_number() over (order by position), designation, quantite, unite, prix_unitaire_ht, taux_tva
  from public.devis_lignes
  where devis_id = d.id and type_ligne = 'normale' and (not est_option or option_choisie) and (not tranche_cond or tranche_ok)
  order by position;

  if not exists (select 1 from public.devis_lignes where devis_id = d.id) and d.montant_ht > 0 then
    update public.factures set montant_ht = d.montant_ht where id = fid;
  end if;

  update public.devis set statut = 'Accepté' where id = d.id and statut in ('Brouillon','Envoyé');
  return fid;
end $$;
