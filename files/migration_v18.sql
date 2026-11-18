-- Pilot v18 : carte interactive des chantiers (position GPS + type de travaux)
-- À exécuter une fois dans Supabase > SQL Editor. Sans risque : n'efface rien.

create table if not exists public.chantier_geo (
  chantier_id uuid primary key references public.chantiers(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lat double precision,
  lng double precision,
  adresse_src text,            -- adresse utilisée pour calculer la position (ou 'manuel' si placée à la main)
  metier text,                 -- type de travaux choisi à la main (sinon deviné d'après le nom)
  updated_at timestamptz not null default now()
);
alter table public.chantier_geo enable row level security;
drop policy if exists own on public.chantier_geo;
create policy own on public.chantier_geo for all using (user_id = auth.uid()) with check (user_id = auth.uid());
