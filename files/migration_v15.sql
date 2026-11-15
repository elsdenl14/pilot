-- Pilot v15 : Terrain, équipes et ressources / Stocks, matériel et approvisionnements
-- À lancer une seule fois dans Supabase > SQL Editor (peut être relancé sans risque). Les migrations v1 à v14 doivent être faites.

-- ============ 1. Équipes et salariés ============
create table if not exists public.equipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  cout_horaire numeric,                       -- coût horaire chargé par défaut de l'équipe (facultatif)
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.salaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  poste text,
  telephone text,
  equipe_id uuid references public.equipes(id) on delete set null,
  salaire_brut_mensuel numeric,
  taux_charges numeric not null default 42,    -- % de charges patronales (indicatif)
  heures_mensuelles numeric not null default 151.67,
  cout_horaire numeric not null default 0,     -- coût horaire chargé retenu
  actif boolean not null default true,
  token uuid not null default gen_random_uuid() unique,  -- lien privé de pointage mobile
  created_at timestamptz not null default now()
);
alter table public.entreprise add column if not exists rh_reglages jsonb;
  -- { seuil_hebdo:35, hs1_pct:25, hs1_jusqua:43, hs2_pct:50, panier_montant:0, trajet_eur_km:0 }

-- ============ 2. Pointages, absences ============
create table if not exists public.pointages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  salarie_id uuid not null references public.salaries(id) on delete cascade,
  date_travail date not null,
  heures numeric not null check (heures > 0 and heures <= 24),
  chantier_id uuid references public.chantiers(id) on delete set null,
  tache_id uuid references public.taches(id) on delete set null,
  description text,
  panier boolean not null default false,
  trajet_minutes int not null default 0,
  trajet_km numeric not null default 0,
  statut text not null default 'À valider' check (statut in ('À valider','Validé','Refusé')),
  motif_refus text,
  temps_id uuid references public.temps_passes(id) on delete set null,   -- ligne créée dans « Temps passés » à la validation
  source text not null default 'mobile',
  client_uid text,                                                       -- évite les doublons lors de la synchronisation hors connexion
  valide_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists pointages_client_uid on public.pointages (salarie_id, client_uid) where client_uid is not null;
create index if not exists pointages_idx on public.pointages (user_id, date_travail);

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  salarie_id uuid not null references public.salaries(id) on delete cascade,
  type text not null default 'Congés payés' check (type in ('Congés payés','RTT','Maladie','Accident du travail','Sans solde','Formation','Intempéries','Autre')),
  date_debut date not null,
  date_fin date not null,
  jours numeric,
  notes text,
  created_at timestamptz not null default now(),
  check (date_fin >= date_debut)
);

-- ============ 3. Affectations (salarié, équipe, matériel) ============
create table if not exists public.affectations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ressource text not null check (ressource in ('salarie','equipe','materiel')),
  salarie_id uuid references public.salaries(id) on delete cascade,
  equipe_id uuid references public.equipes(id) on delete cascade,
  materiel_id uuid references public.materiel(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  date_debut date not null,
  date_fin date not null,
  heure_debut time,
  heure_fin time,
  notes text,
  created_at timestamptz not null default now(),
  check (date_fin >= date_debut)
);
create index if not exists affectations_idx on public.affectations (user_id, date_debut);

-- ============ 4. Rapports d'intervention et photos ============
create table if not exists public.rapports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero text,
  salarie_id uuid references public.salaries(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  client_nom text,
  adresse text,
  date_intervention date not null default current_date,
  heure_debut text,
  heure_fin text,
  objet text,
  constat text,
  travaux text,
  fournitures jsonb not null default '[]'::jsonb,   -- [{designation, quantite, unite, prix_unitaire_ht}]
  heures numeric not null default 0,
  a_suivre text,
  statut text not null default 'Signé' check (statut in ('Brouillon','Signé','Facturé')),
  signataire_nom text,
  signature text,                                   -- image PNG (data URL)
  signe_at timestamptz,
  facture_id uuid references public.factures(id) on delete set null,
  client_uid text,
  created_at timestamptz not null default now()
);
create unique index if not exists rapports_client_uid on public.rapports (salarie_id, client_uid) where client_uid is not null;

create table if not exists public.terrain_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  salarie_id uuid references public.salaries(id) on delete set null,
  chantier_id uuid references public.chantiers(id) on delete set null,
  rapport_id uuid references public.rapports(id) on delete cascade,
  legende text,
  data text not null,                               -- JPEG réduit (data URL)
  client_uid text,
  created_at timestamptz not null default now()
);
create unique index if not exists terrain_photos_uid on public.terrain_photos (salarie_id, client_uid) where client_uid is not null;

-- ============ 5. Stocks ============
create table if not exists public.stock_lieux (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null,
  type text not null default 'Dépôt' check (type in ('Dépôt','Véhicule')),
  notes text,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.stock_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reference text,
  designation text not null,
  unite text not null default 'u',
  categorie text,
  prix_unitaire numeric not null default 0,         -- dernier prix d'achat
  seuil_mini numeric not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.stock_mouvements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date_mouvement date not null default current_date,
  type text not null check (type in ('Entrée','Sortie','Transfert','Retour','Inventaire')),
  article_id uuid not null references public.stock_articles(id) on delete cascade,
  lieu_source_id uuid references public.stock_lieux(id) on delete restrict,
  lieu_dest_id uuid references public.stock_lieux(id) on delete restrict,
  chantier_id uuid references public.chantiers(id) on delete set null,
  quantite numeric not null check (quantite > 0),
  prix_unitaire numeric,
  notes text,
  origine text,                                     -- ex : « inventaire », « livraison »
  created_at timestamptz not null default now()
);
create index if not exists stock_mv_idx on public.stock_mouvements (user_id, article_id, date_mouvement);

create table if not exists public.stock_inventaires (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lieu_id uuid not null references public.stock_lieux(id) on delete cascade,
  date_inventaire date not null default current_date,
  statut text not null default 'En cours' check (statut in ('En cours','Validé')),
  valeur_stock numeric,
  ecart_valeur numeric,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.stock_inventaire_lignes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  inventaire_id uuid not null references public.stock_inventaires(id) on delete cascade,
  article_id uuid not null references public.stock_articles(id) on delete cascade,
  theorique numeric not null default 0,
  compte numeric,
  pmp numeric not null default 0
);

-- ============ 6. Matériel : locations et indisponibilités ============
create table if not exists public.materiel_periodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  materiel_id uuid references public.materiel(id) on delete cascade,   -- vide pour une location d'un engin que vous ne possédez pas
  type text not null default 'Indisponibilité' check (type in ('Location','Indisponibilité')),
  libelle text,                                      -- nom de l'engin loué
  date_debut date not null,
  date_fin date not null,
  loueur text,
  cout_jour numeric not null default 0,
  chantier_id uuid references public.chantiers(id) on delete set null,
  motif text,
  created_at timestamptz not null default now(),
  check (date_fin >= date_debut)
);

-- ============ 7. Rapprochement commande / livraison / facture ============
create table if not exists public.rapprochements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fournisseur text not null,
  ref_commande text,
  date_commande date default current_date,
  chantier_id uuid references public.chantiers(id) on delete set null,
  achat_id uuid references public.achats_fournisseurs(id) on delete set null,
  notes text,
  cloture boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.rapprochement_lignes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rapprochement_id uuid not null references public.rapprochements(id) on delete cascade,
  position int not null default 1,
  designation text not null,
  unite text not null default 'u',
  qte_cmd numeric not null default 0,
  pu_cmd numeric not null default 0,
  article_id uuid references public.stock_articles(id) on delete set null
);
create table if not exists public.rapprochement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rapprochement_id uuid not null references public.rapprochements(id) on delete cascade,
  ligne_id uuid not null references public.rapprochement_lignes(id) on delete cascade,
  type text not null check (type in ('Livraison','Facture')),
  date_event date not null default current_date,
  doc_ref text,                                      -- n° de bon de livraison ou de facture
  quantite numeric not null,
  prix_unitaire numeric,
  mouvement_id uuid references public.stock_mouvements(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============ 8. Sécurité (une politique « own » par table) ============
do $$
declare t text;
begin
  foreach t in array array['equipes','salaries','pointages','absences','affectations','rapports','terrain_photos',
    'stock_lieux','stock_articles','stock_mouvements','stock_inventaires','stock_inventaire_lignes','materiel_periodes',
    'rapprochements','rapprochement_lignes','rapprochement_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own on public.%I', t);
    execute format('create policy own on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ============ 9. Page mobile des compagnons (sans compte, par lien privé) ============
create or replace function public._terrain_salarie(p_token uuid) returns public.salaries
language plpgsql security definer set search_path = public as $$
declare s public.salaries;
begin
  select * into s from public.salaries where token = p_token and actif;
  if not found then raise exception 'Lien invalide ou désactivé.'; end if;
  return s;
end $$;

create or replace function public.terrain_get(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.salaries; out jsonb;
begin
  s := public._terrain_salarie(p_token);
  select jsonb_build_object(
    'salarie', jsonb_build_object('id', s.id, 'nom', s.nom),
    'entreprise', (select nom from public.entreprise where user_id = s.user_id),
    'chantiers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nom', c.nom, 'ville', c.ville, 'client_id', c.client_id, 'client', cl.nom) order by c.nom)
        from public.chantiers c join public.clients cl on cl.id = c.client_id where c.user_id = s.user_id and c.statut <> 'Terminé'), '[]'::jsonb),
    'taches', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'titre', t.titre, 'chantier_id', t.chantier_id, 'echeance', t.echeance) order by t.echeance nulls last)
        from public.taches t where t.user_id = s.user_id and t.statut <> 'Terminée'
          and (t.assigne is null or t.assigne = '' or lower(t.assigne) = lower(s.nom))), '[]'::jsonb),
    'pointages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'date', p.date_travail, 'heures', p.heures, 'chantier_id', p.chantier_id,
        'description', p.description, 'statut', p.statut, 'motif', p.motif_refus, 'client_uid', p.client_uid) order by p.date_travail desc, p.created_at desc)
        from public.pointages p where p.salarie_id = s.id and p.date_travail >= current_date - 21), '[]'::jsonb),
    'absences', coalesce((select jsonb_agg(jsonb_build_object('type', a.type, 'debut', a.date_debut, 'fin', a.date_fin) order by a.date_debut)
        from public.absences a where a.salarie_id = s.id and a.date_fin >= current_date), '[]'::jsonb)
  ) into out;
  return out;
end $$;

create or replace function public.terrain_pointer(p_token uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.salaries; e jsonb; n int := 0; h numeric; d date; ch uuid; ta uuid;
begin
  s := public._terrain_salarie(p_token);
  for e in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    h := (e->>'heures')::numeric; d := (e->>'date')::date;
    if h is null or h <= 0 or h > 24 then raise exception 'Heures invalides.'; end if;
    if d > current_date + 1 or d < current_date - 90 then raise exception 'Date hors limites (90 jours).'; end if;
    if coalesce(e->>'client_uid', '') = '' then raise exception 'Identifiant manquant.'; end if;
    ch := null; ta := null;
    if coalesce(e->>'chantier_id', '') <> '' then select id into ch from public.chantiers where id = (e->>'chantier_id')::uuid and user_id = s.user_id; end if;
    if coalesce(e->>'tache_id', '') <> '' then select id into ta from public.taches where id = (e->>'tache_id')::uuid and user_id = s.user_id; end if;
    insert into public.pointages (user_id, salarie_id, date_travail, heures, chantier_id, tache_id, description, panier, trajet_minutes, trajet_km, client_uid)
    values (s.user_id, s.id, d, h, ch, ta, nullif(left(coalesce(e->>'description', ''), 500), ''),
            coalesce((e->>'panier')::boolean, false), greatest(0, coalesce((e->>'trajet_minutes')::int, 0)), greatest(0, coalesce((e->>'trajet_km')::numeric, 0)), e->>'client_uid')
    on conflict (salarie_id, client_uid) where client_uid is not null do update
      set date_travail = excluded.date_travail, heures = excluded.heures, chantier_id = excluded.chantier_id, tache_id = excluded.tache_id,
          description = excluded.description, panier = excluded.panier, trajet_minutes = excluded.trajet_minutes, trajet_km = excluded.trajet_km, statut = 'À valider', motif_refus = null
      where public.pointages.statut <> 'Validé';
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', n);
end $$;

create or replace function public.terrain_photo(p_token uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.salaries; ch uuid; rp uuid;
begin
  s := public._terrain_salarie(p_token);
  if coalesce(p->>'data', '') !~ '^data:image/(jpeg|png);base64,' or length(p->>'data') > 1800000 then raise exception 'Photo invalide ou trop lourde.'; end if;
  if coalesce(p->>'client_uid', '') = '' then raise exception 'Identifiant manquant.'; end if;
  if coalesce(p->>'chantier_id', '') <> '' then select id into ch from public.chantiers where id = (p->>'chantier_id')::uuid and user_id = s.user_id; end if;
  if coalesce(p->>'rapport_uid', '') <> '' then select id into rp from public.rapports where salarie_id = s.id and client_uid = p->>'rapport_uid'; end if;
  insert into public.terrain_photos (user_id, salarie_id, chantier_id, rapport_id, legende, data, client_uid)
  values (s.user_id, s.id, ch, rp, nullif(left(coalesce(p->>'legende', ''), 200), ''), p->>'data', p->>'client_uid')
  on conflict (salarie_id, client_uid) where client_uid is not null do nothing;
  return jsonb_build_object('ok', 1);
end $$;

create or replace function public.terrain_rapport(p_token uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.salaries; ch uuid; cl uuid; num text; n int; rid uuid;
begin
  s := public._terrain_salarie(p_token);
  if coalesce(p->>'client_uid', '') = '' then raise exception 'Identifiant manquant.'; end if;
  if coalesce(p->>'signature', '') !~ '^data:image/png;base64,' or length(p->>'signature') > 600000 then raise exception 'Signature manquante.'; end if;
  if btrim(coalesce(p->>'signataire_nom', '')) = '' then raise exception 'Nom du signataire manquant.'; end if;
  select id into rid from public.rapports where salarie_id = s.id and client_uid = p->>'client_uid';
  if rid is not null then return jsonb_build_object('ok', 1, 'doublon', true); end if;
  if coalesce(p->>'chantier_id', '') <> '' then select id, client_id into ch, cl from public.chantiers where id = (p->>'chantier_id')::uuid and user_id = s.user_id; end if;
  select count(*) + 1 into n from public.rapports where user_id = s.user_id and extract(year from date_intervention) = extract(year from coalesce((p->>'date')::date, current_date));
  num := 'RPT-' || extract(year from coalesce((p->>'date')::date, current_date))::int || '-' || lpad(n::text, 3, '0');
  insert into public.rapports (user_id, numero, salarie_id, chantier_id, client_id, client_nom, adresse, date_intervention, heure_debut, heure_fin, objet, constat, travaux,
                               fournitures, heures, a_suivre, statut, signataire_nom, signature, signe_at, client_uid)
  values (s.user_id, num, s.id, ch, cl, left(coalesce(p->>'client_nom', ''), 200), left(coalesce(p->>'adresse', ''), 300), coalesce((p->>'date')::date, current_date),
          left(coalesce(p->>'heure_debut', ''), 5), left(coalesce(p->>'heure_fin', ''), 5), left(coalesce(p->>'objet', ''), 300), left(coalesce(p->>'constat', ''), 3000), left(coalesce(p->>'travaux', ''), 3000),
          coalesce(p->'fournitures', '[]'::jsonb), greatest(0, coalesce((p->>'heures')::numeric, 0)), left(coalesce(p->>'a_suivre', ''), 1000), 'Signé',
          left(p->>'signataire_nom', 120), p->>'signature', now(), p->>'client_uid');
  return jsonb_build_object('ok', 1, 'numero', num);
end $$;

revoke execute on function public._terrain_salarie(uuid) from public, anon, authenticated;
revoke execute on function public.terrain_get(uuid), public.terrain_pointer(uuid, jsonb), public.terrain_photo(uuid, jsonb), public.terrain_rapport(uuid, jsonb) from public;
grant execute on function public.terrain_get(uuid), public.terrain_pointer(uuid, jsonb), public.terrain_photo(uuid, jsonb), public.terrain_rapport(uuid, jsonb) to anon, authenticated;
