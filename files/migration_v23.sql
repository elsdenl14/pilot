-- Pilot v23 · Métrés et quantitatifs (import de plans PDF, mesures, annotations)
-- À lancer une fois dans Supabase > SQL Editor. Sans cette migration, le reste de Pilot fonctionne normalement.

create table if not exists public.metres_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  nom text not null,
  chemin text not null,                      -- fichier dans le bucket « documents »
  type text not null default 'pdf',          -- pdf | image
  nb_pages int not null default 1,
  data jsonb not null default '{}'::jsonb,   -- échelles, mesures, annotations, réglages
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists metres_plans_chantier_idx on public.metres_plans(chantier_id);

alter table public.metres_plans enable row level security;
drop policy if exists own on public.metres_plans;
create policy own on public.metres_plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
