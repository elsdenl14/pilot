-- =====================================================================
--  PILOT — schéma Supabase (devis, factures, paiements, clients, chantiers)
--  À coller en entier dans : Supabase > SQL Editor > New query > Run
--  Rejouable sans risque (create if not exists / create or replace).
-- =====================================================================

-- ---------- 1. TABLES -------------------------------------------------

-- Fiche entreprise : une ligne par compte utilisateur
create table if not exists public.entreprise (
  user_id                uuid primary key default auth.uid() references auth.users on delete cascade,
  nom                    text not null default '',
  siret                  text,
  adresse                text,
  email                  text,
  telephone              text,
  tva_intracom           text,
  taux_tva_defaut        numeric(5,2) not null default 20,
  delai_paiement_jours   int not null default 30,
  modele_devis           text not null default 'Devis standard',
  modele_facture         text not null default 'Facture standard',
  modele_devis_fichier   text,   -- chemin dans le bucket "documents"
  modele_facture_fichier text,
  updated_at             timestamptz not null default now()
);

create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  nom        text not null,
  type       text not null default 'Particulier' check (type in ('Particulier','Professionnel')),
  ville      text,
  email      text,
  telephone  text,
  adresse    text,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists public.chantiers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  client_id      uuid not null references public.clients on delete restrict,
  nom            text not null,
  ville          text,
  montant_marche numeric(12,2) not null default 0 check (montant_marche >= 0),
  avancement     int not null default 0 check (avancement between 0 and 100),
  statut         text not null default 'En cours'
                 check (statut in ('En cours','À surveiller','À facturer','Terminé')),
  date_debut     date,
  date_fin       date,
  created_at     timestamptz not null default now()
);

create table if not exists public.devis (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  numero        text,                                   -- rempli automatiquement (DEV-2026-001)
  client_id     uuid not null references public.clients on delete restrict,
  chantier_id   uuid references public.chantiers on delete set null,
  date_devis    date not null default current_date,
  validite_jours int not null default 30,
  statut        text not null default 'Brouillon'
                check (statut in ('Brouillon','Envoyé','Accepté','Refusé')),
  montant_ht    numeric(12,2) not null default 0 check (montant_ht >= 0),
  taux_tva      numeric(5,2)  not null default 20,
  montant_ttc   numeric(12,2) generated always as (round(montant_ht * (1 + taux_tva/100), 2)) stored,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (user_id, numero)
);

create table if not exists public.devis_lignes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  devis_id         uuid not null references public.devis on delete cascade,
  position         int not null default 1,
  designation      text not null,
  quantite         numeric(12,3) not null default 1,
  unite            text not null default 'u',
  prix_unitaire_ht numeric(12,2) not null default 0
);

create table if not exists public.factures (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  numero        text,                                   -- FAC-2026-001, sans trou
  client_id     uuid not null references public.clients on delete restrict,
  chantier_id   uuid references public.chantiers on delete set null,
  devis_id      uuid references public.devis on delete set null,
  date_emission date not null default current_date,
  echeance      date not null default (current_date + 30),
  statut        text not null default 'Brouillon'
                check (statut in ('Brouillon','Envoyée','Partiellement payée','Payée','Annulée')),
  montant_ht    numeric(12,2) not null default 0 check (montant_ht >= 0),
  taux_tva      numeric(5,2)  not null default 20,
  montant_ttc   numeric(12,2) generated always as (round(montant_ht * (1 + taux_tva/100), 2)) stored,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (user_id, numero)
);

create table if not exists public.factures_lignes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  facture_id       uuid not null references public.factures on delete cascade,
  position         int not null default 1,
  designation      text not null,
  quantite         numeric(12,3) not null default 1,
  unite            text not null default 'u',
  prix_unitaire_ht numeric(12,2) not null default 0
);

create table if not exists public.paiements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  facture_id  uuid not null references public.factures on delete restrict,
  date_paiement date not null default current_date,
  montant     numeric(12,2) not null check (montant > 0),
  mode        text not null default 'Virement' check (mode in ('Virement','Chèque','Carte','Espèces')),
  reference   text,
  created_at  timestamptz not null default now()
);

-- Compteurs de numérotation (un par utilisateur, type et année)
create table if not exists public.compteurs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type    text not null check (type in ('devis','facture')),
  annee   int  not null,
  derniere int not null default 0,
  primary key (user_id, type, annee)
);

create index if not exists clients_user_idx    on public.clients(user_id);
create index if not exists chantiers_client_idx on public.chantiers(client_id);
create index if not exists devis_client_idx    on public.devis(client_id);
create index if not exists factures_client_idx on public.factures(client_id);
create index if not exists paiements_fact_idx  on public.paiements(facture_id);

-- ---------- 2. SÉCURITÉ (RLS) ----------------------------------------
-- Chaque utilisateur ne voit et ne modifie QUE ses propres lignes.

do $$
declare t text;
begin
  foreach t in array array['entreprise','clients','chantiers','devis','devis_lignes',
                           'factures','factures_lignes','paiements','compteurs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "proprietaire" on public.%I', t);
    execute format(
      'create policy "proprietaire" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------- 3. NUMÉROTATION AUTOMATIQUE ------------------------------

create or replace function public.prochain_numero(p_type text, p_annee int)
returns int language plpgsql as $$
declare n int;
begin
  insert into public.compteurs (user_id, type, annee, derniere)
  values (auth.uid(), p_type, p_annee, 1)
  on conflict (user_id, type, annee)
  do update set derniere = public.compteurs.derniere + 1
  returning derniere into n;
  return n;
end $$;

create or replace function public.trg_numero_devis() returns trigger
language plpgsql as $$
begin
  if new.numero is null then
    new.numero := 'DEV-' || extract(year from new.date_devis)::int || '-' ||
                  lpad(public.prochain_numero('devis', extract(year from new.date_devis)::int)::text, 3, '0');
  end if;
  return new;
end $$;

create or replace function public.trg_numero_facture() returns trigger
language plpgsql as $$
begin
  if new.numero is null then
    new.numero := 'FAC-' || extract(year from new.date_emission)::int || '-' ||
                  lpad(public.prochain_numero('facture', extract(year from new.date_emission)::int)::text, 3, '0');
  end if;
  return new;
end $$;

drop trigger if exists numero_devis on public.devis;
create trigger numero_devis before insert on public.devis
  for each row execute function public.trg_numero_devis();

drop trigger if exists numero_facture on public.factures;
create trigger numero_facture before insert on public.factures
  for each row execute function public.trg_numero_facture();

-- ---------- 4. TOTAUX CALCULÉS À PARTIR DES LIGNES -------------------
-- Dès qu'un devis/une facture a des lignes, montant_ht = somme des lignes.

create or replace function public.trg_total_devis() returns trigger
language plpgsql as $$
declare d uuid := coalesce(new.devis_id, old.devis_id);
begin
  update public.devis set montant_ht =
    coalesce((select sum(round(quantite * prix_unitaire_ht, 2)) from public.devis_lignes where devis_id = d), 0)
  where id = d;
  return null;
end $$;

create or replace function public.trg_total_facture() returns trigger
language plpgsql as $$
declare f uuid := coalesce(new.facture_id, old.facture_id);
begin
  update public.factures set montant_ht =
    coalesce((select sum(round(quantite * prix_unitaire_ht, 2)) from public.factures_lignes where facture_id = f), 0)
  where id = f;
  return null;
end $$;

drop trigger if exists total_devis on public.devis_lignes;
create trigger total_devis after insert or update or delete on public.devis_lignes
  for each row execute function public.trg_total_devis();

drop trigger if exists total_facture on public.factures_lignes;
create trigger total_facture after insert or update or delete on public.factures_lignes
  for each row execute function public.trg_total_facture();

-- ---------- 5. FACTURES : VERROU LÉGAL + STATUT AUTOMATIQUE ----------
-- Une facture émise ne se supprime plus et son montant ne change plus
-- (on l'annule et on émet un avoir / une nouvelle facture).

create or replace function public.trg_verrou_facture() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'Brouillon' then
      raise exception 'Facture % émise : suppression interdite (passez-la en Annulée).', old.numero;
    end if;
    return old;
  end if;
  if old.statut <> 'Brouillon' and (
       new.montant_ht <> old.montant_ht or new.taux_tva <> old.taux_tva
       or new.client_id <> old.client_id or new.numero is distinct from old.numero) then
    raise exception 'Facture % émise : montant, TVA, client et numéro sont verrouillés.', old.numero;
  end if;
  return new;
end $$;

drop trigger if exists verrou_facture on public.factures;
create trigger verrou_facture before update or delete on public.factures
  for each row execute function public.trg_verrou_facture();

-- Après chaque paiement : recalcule le statut de la facture
create or replace function public.trg_paiement() returns trigger
language plpgsql as $$
declare
  fid uuid := coalesce(new.facture_id, old.facture_id);
  f   public.factures;
  paye numeric;
begin
  select * into f from public.factures where id = fid;
  select coalesce(sum(montant), 0) into paye from public.paiements where facture_id = fid;

  if tg_op <> 'DELETE' then
    if f.statut in ('Brouillon','Annulée') then
      raise exception 'Impossible d''enregistrer un paiement sur une facture % (%).', f.numero, f.statut;
    end if;
    if paye > f.montant_ttc then
      raise exception 'Le paiement dépasse le reste à payer de la facture %.', f.numero;
    end if;
  end if;

  if f.statut not in ('Brouillon','Annulée') then
    update public.factures set statut =
      case when paye >= f.montant_ttc and f.montant_ttc > 0 then 'Payée'
           when paye > 0 then 'Partiellement payée'
           else 'Envoyée' end
    where id = fid;
  end if;
  return null;
end $$;

drop trigger if exists paiement_statut on public.paiements;
create trigger paiement_statut after insert or update or delete on public.paiements
  for each row execute function public.trg_paiement();

-- ---------- 6. VUES DE LECTURE (utilisées par l'appli) ---------------
-- security_invoker = les règles RLS de l'utilisateur s'appliquent aussi aux vues.

create or replace view public.v_chantiers with (security_invoker = true) as
select ch.*, c.nom as client_nom
from public.chantiers ch join public.clients c on c.id = ch.client_id;

create or replace view public.v_devis with (security_invoker = true) as
select d.*, c.nom as client_nom, ch.nom as chantier_nom
from public.devis d
join public.clients c on c.id = d.client_id
left join public.chantiers ch on ch.id = d.chantier_id;

create or replace view public.v_factures with (security_invoker = true) as
select f.*, c.nom as client_nom, ch.nom as chantier_nom,
       coalesce(p.paye, 0)                          as paye,
       f.montant_ttc - coalesce(p.paye, 0)          as reste,
       case when f.statut in ('Envoyée','Partiellement payée') and f.echeance < current_date
            then 'En retard' else f.statut end      as statut_affiche
from public.factures f
join public.clients c on c.id = f.client_id
left join public.chantiers ch on ch.id = f.chantier_id
left join lateral (select sum(montant) as paye from public.paiements where facture_id = f.id) p on true;

create or replace view public.v_paiements with (security_invoker = true) as
select p.*, f.numero as facture_numero, c.nom as client_nom
from public.paiements p
join public.factures f on f.id = p.facture_id
join public.clients c on c.id = f.client_id;

-- CA = total HT des factures émises (hors brouillon/annulée) ; à encaisser = reste dû TTC
create or replace view public.v_clients_stats with (security_invoker = true) as
select c.*,
  (select count(*) from public.chantiers ch where ch.client_id = c.id)                       as nb_chantiers,
  coalesce((select sum(f.montant_ht) from public.factures f
            where f.client_id = c.id and f.statut not in ('Brouillon','Annulée')), 0)        as ca,
  coalesce((select sum(f.reste) from public.v_factures f
            where f.client_id = c.id and f.statut not in ('Brouillon','Annulée')), 0)        as a_encaisser
from public.clients c;

-- ---------- 7. DEVIS ACCEPTÉ -> FACTURE EN UN CLIC -------------------
-- Appel depuis l'appli :  supabase.rpc('devis_vers_facture', { p_devis: '<uuid>' })

create or replace function public.devis_vers_facture(p_devis uuid)
returns uuid language plpgsql as $$
declare
  d public.devis;
  delai int;
  fid uuid;
begin
  select * into d from public.devis where id = p_devis;
  if not found then raise exception 'Devis introuvable'; end if;
  select coalesce(delai_paiement_jours, 30) into delai from public.entreprise where user_id = auth.uid();

  insert into public.factures (client_id, chantier_id, devis_id, echeance, montant_ht, taux_tva)
  values (d.client_id, d.chantier_id, d.id, current_date + coalesce(delai, 30), d.montant_ht, d.taux_tva)
  returning id into fid;

  insert into public.factures_lignes (facture_id, position, designation, quantite, unite, prix_unitaire_ht)
  select fid, position, designation, quantite, unite, prix_unitaire_ht
  from public.devis_lignes where devis_id = d.id;

  update public.devis set statut = 'Accepté' where id = d.id and statut <> 'Accepté';
  return fid;
end $$;

-- ---------- 8. STOCKAGE DES FICHIERS (PDF, modèles, logos) -----------
-- Bucket privé "documents" ; chaque utilisateur n'accède qu'au dossier <son user_id>/...

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents_proprietaire" on storage.objects;
create policy "documents_proprietaire" on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
