-- Pilot v21 : contrats d'entretien, bons d'intervention, comparateur fournisseurs, bons de livraison,
-- multi-sociétés, personnalisation. À exécuter une fois dans Supabase > SQL Editor. N'efface rien.

-- ============ 1. Sociétés (multi-entreprises) ============
create table if not exists public.societes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  forme text, siret text, tva_intracom text, adresse text, telephone text, email text,
  iban text, bic text, couleur text,
  principale boolean not null default false,
  created_at timestamptz not null default now()
);
-- Rattachement d'une ligne (client, chantier, devis, facture…) à une société, sans toucher aux tables d'origine
create table if not exists public.societe_liens (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entite text not null,
  row_id uuid not null,
  societe_id uuid not null references public.societes(id) on delete cascade,
  primary key (user_id, entite, row_id)
);
create index if not exists societe_liens_soc on public.societe_liens (societe_id);

-- ============ 2. Champs personnalisés : valeurs par fiche ============
create table if not exists public.champs_valeurs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entite text not null,
  row_id uuid not null,
  valeurs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, entite, row_id)
);

-- ============ 3. Contrats d'entretien ============
create table if not exists public.contrats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  societe_id uuid references public.societes(id) on delete set null,
  numero text,
  libelle text not null,
  client_id uuid references public.clients(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  site_adresse text,
  date_debut date not null,
  date_fin date not null,
  renouvellement_auto boolean not null default true,
  duree_renouv_mois int not null default 12,
  preavis_jours int not null default 60,
  rappel_jours int not null default 30,
  visites_par_an int not null default 1,
  facturation text not null default 'annuelle' check (facturation in ('mensuelle','trimestrielle','semestrielle','annuelle')),
  montant_ht numeric not null default 0,           -- montant HT de chaque échéance de facturation
  taux_tva numeric not null default 20,
  prochaine_facturation date,
  statut text not null default 'Actif' check (statut in ('Actif','Suspendu','Résilié','Terminé')),
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.contrat_visites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contrat_id uuid not null references public.contrats(id) on delete cascade,
  date_prevue date not null,
  statut text not null default 'Planifiée' check (statut in ('Planifiée','Réalisée','Annulée')),
  date_realisee date,
  intervention_id uuid,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists contrat_visites_u on public.contrat_visites (contrat_id, date_prevue);
create table if not exists public.contrat_factures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contrat_id uuid not null references public.contrats(id) on delete cascade,
  facture_id uuid references public.factures(id) on delete set null,
  periode_debut date not null,
  periode_fin date not null,
  montant_ht numeric not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists contrat_factures_u on public.contrat_factures (contrat_id, periode_debut);

-- ============ 4. Bons d'intervention ============
create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  societe_id uuid references public.societes(id) on delete set null,
  numero text,
  client_id uuid references public.clients(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  contrat_id uuid references public.contrats(id) on delete set null,
  visite_id uuid,
  salarie_id uuid,
  technicien text,
  date_prevue date not null default current_date,
  heure text,
  statut text not null default 'Planifiée' check (statut in ('Planifiée','En cours','Terminée','Facturée','Annulée')),
  motif text,
  description text,
  heures numeric not null default 0,
  taux_horaire numeric not null default 0,
  deplacement_ht numeric not null default 0,
  taux_tva numeric not null default 20,
  pieces jsonb not null default '[]'::jsonb,       -- [{designation, quantite, unite, prix_unitaire_ht}]
  signataire text,
  signature_data text,
  signe_at timestamptz,
  facture_id uuid references public.factures(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists interventions_num on public.interventions (user_id, numero) where numero is not null;
create table if not exists public.intervention_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  phase text not null default 'avant' check (phase in ('avant','apres')),
  legende text,
  data text not null,
  created_at timestamptz not null default now()
);

-- ============ 5. Comparateur fournisseurs ============
create table if not exists public.demandes_prix (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  societe_id uuid references public.societes(id) on delete set null,
  numero text,
  libelle text not null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  date_demande date not null default current_date,
  date_limite date,
  statut text not null default 'Brouillon' check (statut in ('Brouillon','Envoyée','Comparée','Clôturée')),
  fournisseur_retenu uuid,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.demande_prix_lignes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demande_id uuid not null references public.demandes_prix(id) on delete cascade,
  position int not null default 0,
  designation text not null,
  quantite numeric not null default 1,
  unite text not null default 'u'
);
create table if not exists public.demande_prix_fournisseurs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demande_id uuid not null references public.demandes_prix(id) on delete cascade,
  fournisseur_id uuid not null references public.fournisseurs(id) on delete cascade,
  envoyee_at timestamptz,
  frais_livraison numeric not null default 0,
  delai_jours int,
  validite date,
  conditions text,
  unique (demande_id, fournisseur_id)
);
create table if not exists public.demande_prix_offres (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demande_id uuid not null references public.demandes_prix(id) on delete cascade,
  ligne_id uuid not null references public.demande_prix_lignes(id) on delete cascade,
  fournisseur_id uuid not null references public.fournisseurs(id) on delete cascade,
  prix_unitaire_ht numeric,
  delai_jours int,
  remarque text,
  created_at timestamptz not null default now(),
  unique (ligne_id, fournisseur_id)
);

-- ============ 6. Bons de livraison ============
create table if not exists public.livraisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  societe_id uuid references public.societes(id) on delete set null,
  numero text,
  client_id uuid references public.clients(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  parent_id uuid references public.livraisons(id) on delete set null,   -- reliquat d'une livraison partielle
  date_prevue date not null default current_date,
  date_livraison date,
  statut text not null default 'En préparation' check (statut in ('En préparation','Prête','Livrée','Livrée partiellement','Facturée','Annulée')),
  transporteur text,
  adresse text,
  receptionnaire text,
  signature_data text,
  signe_at timestamptz,
  notes text,
  facture_id uuid references public.factures(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists livraisons_num on public.livraisons (user_id, numero) where numero is not null;
create table if not exists public.livraison_lignes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  livraison_id uuid not null references public.livraisons(id) on delete cascade,
  position int not null default 0,
  designation text not null,
  unite text not null default 'u',
  qte_prevue numeric not null default 0,
  qte_livree numeric not null default 0,
  prix_unitaire_ht numeric not null default 0,
  taux_tva numeric not null default 20
);

-- ============ 7. Sécurité (une politique « own » par table) ============
do $$
declare t text;
begin
  foreach t in array array['societes','societe_liens','champs_valeurs','contrats','contrat_visites','contrat_factures',
    'interventions','intervention_photos','demandes_prix','demande_prix_lignes','demande_prix_fournisseurs','demande_prix_offres',
    'livraisons','livraison_lignes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own on public.%I', t);
    execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
