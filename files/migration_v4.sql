-- À exécuter une fois dans Supabase > SQL Editor. Sans risque : "if not exists" partout.

-- 1. Catégories et descriptions sur les lignes de devis et de facture
alter table devis_lignes    add column if not exists categorie text, add column if not exists description text;
alter table factures_lignes add column if not exists categorie text, add column if not exists description text;

-- 2. Échéancier : payer une facture en plusieurs fois
create table if not exists facture_echeances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  facture_id uuid not null references factures(id) on delete cascade,
  position int not null default 0,
  libelle text,
  date_echeance date not null,
  montant numeric not null check (montant > 0),
  created_at timestamptz not null default now()
);
create index if not exists facture_echeances_facture_idx on facture_echeances(facture_id);
alter table facture_echeances enable row level security;
drop policy if exists "facture_echeances_own" on facture_echeances;
create policy "facture_echeances_own" on facture_echeances for all using (user_id = auth.uid()) with check (user_id = auth.uid());
