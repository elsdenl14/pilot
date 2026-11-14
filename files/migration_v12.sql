-- Pilot · migration v12
--   Calendrier, tâches, planning chantier, matériel, sous-traitants, temps passés, objectifs annuels, projection de trésorerie.
-- À exécuter une fois dans Supabase > SQL Editor. Idempotent. Prérequis : migrations v1 à v11.

create table if not exists public.taches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titre text not null,
  description text,
  chantier_id uuid references public.chantiers(id) on delete set null,
  assigne text,
  priorite text not null default 'Normale' check (priorite in ('Basse','Normale','Haute','Urgente')),
  statut text not null default 'À faire' check (statut in ('À faire','En cours','Bloquée','Terminée')),
  echeance date,
  duree_estimee_h numeric,
  termine_le date,
  created_at timestamptz not null default now()
);
create index if not exists taches_user_idx on public.taches (user_id, statut, echeance);

create table if not exists public.evenements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titre text not null,
  type text not null default 'RDV' check (type in ('RDV','Visite','Réunion','Livraison','Congé','Autre')),
  date_debut date not null,
  heure_debut text,
  date_fin date,
  heure_fin text,
  chantier_id uuid references public.chantiers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  lieu text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists evenements_user_idx on public.evenements (user_id, date_debut);

create table if not exists public.planning_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chantier_id uuid not null references public.chantiers(id) on delete cascade,
  nom text not null,
  date_debut date not null,
  date_fin date not null,
  avancement int not null default 0 check (avancement between 0 and 100),
  equipe text,
  sous_traitant_id uuid,
  ordre int not null default 0,
  created_at timestamptz not null default now(),
  check (date_fin >= date_debut)
);
create index if not exists phases_user_idx on public.planning_phases (user_id, chantier_id);

create table if not exists public.sous_traitants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  metier text,
  siret text,
  contact text,
  telephone text,
  email text,
  adresse text,
  ville text,
  iban text,
  taux_horaire numeric,
  assurance_decennale_fin date,
  assurance_rc_fin date,
  vigilance_urssaf_fin date,
  kbis_date date,
  qualite int check (qualite between 1 and 5),
  actif boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
do $$ begin
  alter table public.planning_phases add constraint phases_st_fk foreign key (sous_traitant_id) references public.sous_traitants(id) on delete set null;
exception when others then null; end $$;

create table if not exists public.st_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sous_traitant_id uuid not null references public.sous_traitants(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  objet text not null,
  montant_ht numeric not null default 0,
  date_debut date,
  date_fin date,
  statut text not null default 'Prévue' check (statut in ('Prévue','En cours','Terminée','Annulée')),
  retenue_pct numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.materiel (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  categorie text,
  marque text,
  reference text,
  numero_serie text,
  date_achat date,
  prix_achat numeric not null default 0,
  cout_jour numeric not null default 0,
  statut text not null default 'Disponible' check (statut in ('Disponible','En service','En maintenance','Hors service','Vendu')),
  prochaine_verification date,
  localisation text,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.materiel_affectations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  materiel_id uuid not null references public.materiel(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  date_debut date not null,
  date_fin date,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.materiel_entretiens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  materiel_id uuid not null references public.materiel(id) on delete cascade,
  date_entretien date not null default current_date,
  type text not null default 'Entretien',
  cout numeric not null default 0,
  prochaine date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.temps_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date_travail date not null default current_date,
  heures numeric not null check (heures > 0 and heures <= 24),
  chantier_id uuid references public.chantiers(id) on delete set null,
  tache_id uuid references public.taches(id) on delete set null,
  intervenant text not null default 'Moi',
  taux_horaire numeric not null default 0,
  description text,
  created_at timestamptz not null default now()
);
create index if not exists temps_user_idx on public.temps_passes (user_id, date_travail);

create table if not exists public.objectifs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  annee int not null,
  ca_ht numeric not null default 0,
  marge_pct numeric not null default 0,
  resultat numeric not null default 0,
  nb_chantiers int not null default 0,
  taux_transfo numeric not null default 0,
  tresorerie_fin numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, annee)
);

create table if not exists public.tresorerie_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  libelle text not null,
  sens text not null default 'Sortie' check (sens in ('Sortie','Entrée')),
  montant numeric not null check (montant >= 0),
  frequence text not null default 'Mensuelle' check (frequence in ('Mensuelle','Trimestrielle','Annuelle','Ponctuelle')),
  date_debut date not null default current_date,
  date_fin date,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.entreprise
  add column if not exists taux_horaire_cout numeric not null default 35,
  add column if not exists taux_horaire_vente numeric not null default 55;

do $$
declare t text;
begin
  foreach t in array array['taches','evenements','planning_phases','sous_traitants','st_missions','materiel','materiel_affectations','materiel_entretiens','temps_passes','objectifs','tresorerie_charges'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own') then
      execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;
