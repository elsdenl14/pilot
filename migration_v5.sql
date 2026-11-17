-- Pilot · migration v5 : suivi financier par chantier + fournisseurs & achats
-- À exécuter une fois dans Supabase > SQL Editor. Idempotent (peut être relancé sans risque).

-- 1. Fournisseurs
create table if not exists public.fournisseurs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  categorie text,
  contact text,
  telephone text,
  email text,
  adresse text,
  ville text,
  notes text,
  delai_paiement_jours int default 30,
  created_at timestamptz not null default now()
);
create unique index if not exists fournisseurs_user_nom_uq on public.fournisseurs (user_id, lower(nom));

-- 2. Budget prévisionnel par chantier
create table if not exists public.chantier_budgets (
  chantier_id uuid primary key references public.chantiers(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  materiaux numeric default 0,
  main_oeuvre numeric default 0,
  sous_traitance numeric default 0,
  updated_at timestamptz not null default now()
);

-- 3. Devis et commandes fournisseurs
create table if not exists public.achats_fournisseurs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fournisseur_id uuid not null references public.fournisseurs(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  type text not null default 'Commande' check (type in ('Devis','Commande')),
  numero text,
  date_doc date default current_date,
  date_livraison date,
  statut text not null default 'En attente'
    check (statut in ('En attente','Accepté','Refusé','Commandée','Livrée','Facturée','Annulée')),
  categorie text,
  montant_ht numeric default 0,
  montant_tva numeric default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists achats_user_idx on public.achats_fournisseurs (user_id);
create index if not exists achats_fourn_idx on public.achats_fournisseurs (fournisseur_id);
create index if not exists achats_chantier_idx on public.achats_fournisseurs (chantier_id);
create index if not exists fournisseurs_user_idx on public.fournisseurs (user_id);

-- 4. Sécurité (RLS) : chacun ne voit que ses données
alter table public.fournisseurs enable row level security;
alter table public.chantier_budgets enable row level security;
alter table public.achats_fournisseurs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['fournisseurs','chantier_budgets','achats_fournisseurs'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own') then
      execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;
