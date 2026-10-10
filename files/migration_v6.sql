-- Pilot · migration v6 : espace Documents + rapprochement bancaire
-- À exécuter une fois dans Supabase > SQL Editor. Idempotent (peut être relancé sans risque).
-- Prérequis : migration_v4.sql et migration_v5.sql déjà exécutées, bucket de stockage « documents » existant.

-- 1. Documents (contrats, photos, plans, attestations… déposés par l'utilisateur)
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  categorie text not null default 'Autres'
    check (categorie in ('Devis','Factures','Factures fournisseurs','Contrats','Photos','Plans','Attestations','Autres')),
  client_id uuid references public.clients(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  chemin text not null,
  mime text,
  taille bigint,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists documents_user_idx on public.documents (user_id);
create index if not exists documents_chantier_idx on public.documents (chantier_id);
create index if not exists documents_client_idx on public.documents (client_id);

-- 2. Comptes bancaires (alimentés par import de relevés CSV / OFX)
create table if not exists public.banque_comptes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  iban text,
  solde_initial numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists banque_comptes_user_idx on public.banque_comptes (user_id);

-- 3. Transactions bancaires
create table if not exists public.banque_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  compte_id uuid not null references public.banque_comptes(id) on delete cascade,
  date_op date not null,
  libelle text not null,
  montant numeric not null,
  statut text not null default 'À rapprocher'
    check (statut in ('À rapprocher','Rapprochée','Ignorée')),
  lien_type text
    check (lien_type in ('paiement','paiement_lie','depense_payee','depense_creee','depense_liee')),
  facture_id uuid references public.factures(id) on delete set null,
  paiement_id uuid references public.paiements(id) on delete set null,
  depense_id uuid references public.depenses(id) on delete set null,
  ref_import text not null,
  created_at timestamptz not null default now(),
  unique (compte_id, ref_import)
);
create index if not exists banque_tx_user_idx on public.banque_transactions (user_id);
create index if not exists banque_tx_compte_idx on public.banque_transactions (compte_id, date_op desc);
create index if not exists banque_tx_statut_idx on public.banque_transactions (user_id, statut);

-- 4. Sécurité (RLS) : chacun ne voit que ses données
alter table public.documents enable row level security;
alter table public.banque_comptes enable row level security;
alter table public.banque_transactions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['documents','banque_comptes','banque_transactions'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own') then
      execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;
