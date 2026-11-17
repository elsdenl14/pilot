-- Pilot v17 : tableau de bord chantier (heures prévues) et journal de chantier
-- À exécuter une fois dans Supabase > SQL Editor. Sans risque : n'efface rien.

-- 1. Heures prévues par chantier (comparées aux heures pointées)
alter table public.chantier_budgets add column if not exists heures_prevues numeric not null default 0;

-- 2. Journal de chantier : une fiche par chantier et par jour
create table if not exists public.journal_chantier (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  date_jour date not null default current_date,
  meteo text,                       -- ex : « Éclaircies »
  temp_min numeric,
  temp_max numeric,
  vent_kmh numeric,
  pluie_mm numeric,
  conditions text not null default 'Normales' check (conditions in ('Normales','Difficiles','Arrêt intempéries')),
  effectifs jsonb not null default '[]'::jsonb,   -- [{nom, heures}]
  travaux text,
  incidents text,
  observations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chantier_id, date_jour)
);
create index if not exists journal_chantier_idx on public.journal_chantier (user_id, chantier_id, date_jour desc);

-- 3. Photos rattachées au journal, classées avant / pendant / après
alter table public.terrain_photos add column if not exists journal_id uuid references public.journal_chantier(id) on delete cascade;
alter table public.terrain_photos add column if not exists phase text check (phase in ('avant','pendant','apres'));

-- 4. Sécurité
alter table public.journal_chantier enable row level security;
drop policy if exists own on public.journal_chantier;
create policy own on public.journal_chantier for all using (user_id = auth.uid()) with check (user_id = auth.uid());
