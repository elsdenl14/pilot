-- =====================================================================
--  PILOT — schéma Supabase v2
--  À coller en entier dans : Supabase > SQL Editor > New query > Run
--  Rejouable sans risque : crée ce qui manque et met à niveau une base v1.
--  (les avertissements "destructive operations" viennent des drop ... if exists)
-- =====================================================================

-- ---------- 1. TABLES -------------------------------------------------

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
  modele_devis_fichier   text,
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
  numero        text,
  client_id     uuid not null references public.clients on delete restrict,
  chantier_id   uuid references public.chantiers on delete set null,
  date_devis    date not null default current_date,
  validite_jours int not null default 30,
  statut        text not null default 'Brouillon'
                check (statut in ('Brouillon','Envoyé','Accepté','Refusé')),
  montant_ht    numeric(12,2) not null default 0 check (montant_ht >= 0),
  taux_tva      numeric(5,2)  not null default 20,
  montant_tva   numeric(12,2) not null default 0,
  montant_ttc   numeric(12,2) generated always as (montant_ht + montant_tva) stored,
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
  prix_unitaire_ht numeric(12,2) not null default 0,
  taux_tva         numeric(5,2) not null default 20
);

create table if not exists public.factures (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  numero        text,
  client_id     uuid not null references public.clients on delete restrict,
  chantier_id   uuid references public.chantiers on delete set null,
  devis_id      uuid references public.devis on delete set null,
  date_emission date not null default current_date,
  echeance      date not null default (current_date + 30),
  statut        text not null default 'Brouillon'
                check (statut in ('Brouillon','Envoyée','Partiellement payée','Payée','Annulée')),
  montant_ht    numeric(12,2) not null default 0 check (montant_ht >= 0),
  taux_tva      numeric(5,2)  not null default 20,
  montant_tva   numeric(12,2) not null default 0,
  montant_ttc   numeric(12,2) generated always as (montant_ht + montant_tva) stored,
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
  prix_unitaire_ht numeric(12,2) not null default 0,
  taux_tva         numeric(5,2) not null default 20
);

create table if not exists public.paiements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  facture_id    uuid not null references public.factures on delete restrict,
  date_paiement date not null default current_date,
  montant       numeric(12,2) not null check (montant > 0),
  mode          text not null default 'Virement' check (mode in ('Virement','Chèque','Carte','Espèces')),
  reference     text,
  created_at    timestamptz not null default now()
);

create table if not exists public.compteurs (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  type     text not null check (type in ('devis','facture')),
  annee    int  not null,
  derniere int not null default 0,
  primary key (user_id, type, annee)
);

-- Achats & dépenses (factures fournisseurs, frais, etc.)
create table if not exists public.depenses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  type          text not null default 'Dépense' check (type in ('Dépense','Achat')),
  fournisseur   text not null,
  categorie     text,
  reference     text,
  date_depense  date not null default current_date,
  echeance      date,
  montant_ht    numeric(12,2) not null check (montant_ht >= 0),
  montant_tva   numeric(12,2) not null default 0 check (montant_tva >= 0),
  montant_ttc   numeric(12,2) generated always as (montant_ht + montant_tva) stored,
  statut        text not null default 'À payer' check (statut in ('À payer','Payée')),
  date_paiement date,
  mode          text check (mode in ('Virement','Chèque','Carte','Espèces','Prélèvement')),
  chantier_id   uuid references public.chantiers on delete set null,
  justificatif  text,          -- chemin dans le bucket "documents"
  notes         text,
  created_at    timestamptz not null default now()
);

-- Relevés bancaires et autres pièces pour le comptable
create table if not exists public.documents_compta (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  type       text not null default 'Relevé bancaire',
  libelle    text not null,
  periode    date,
  chemin     text not null,
  created_at timestamptz not null default now()
);

-- Accès en lecture seule donné à un comptable (par email)
create table if not exists public.acces_comptable (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, email)
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  type       text not null default 'info',
  titre      text not null,
  message    text,
  lien       text,
  lu         boolean not null default false,
  created_at timestamptz not null default now()
);

-- Liens de partage en ligne (page client p.html?t=<token>)
create table if not exists public.partages (
  token       uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  type        text not null check (type in ('devis','facture')),
  doc_id      uuid not null,
  pdf_path    text,
  created_at  timestamptz not null default now(),
  vu_at       timestamptz,
  accepte_at  timestamptz,
  accepte_par text,
  refuse_at   timestamptz,
  refuse_motif text
);

-- ---------- 2. MISE À NIVEAU D'UNE BASE v1 ---------------------------

alter table public.entreprise
  add column if not exists iban text,
  add column if not exists bic text,
  add column if not exists forme_juridique text,
  add column if not exists rcs text,
  add column if not exists mentions_legales text,
  add column if not exists tva_regime text not null default 'encaissements',
  add column if not exists tresorerie_initiale numeric(12,2) not null default 0,
  add column if not exists logo_path text,
  add column if not exists pdf_reglages jsonb not null default '{}'::jsonb,
  add column if not exists jour_tva int not null default 20;

-- notifications : clé anti-doublon (alertes de retard)
alter table public.notifications add column if not exists cle text;
create unique index if not exists notif_cle_idx on public.notifications(user_id, cle) where cle is not null;

alter table public.chantiers
  add column if not exists adresse text,
  add column if not exists notes text;

alter table public.devis_lignes    add column if not exists taux_tva numeric(5,2) not null default 20;
alter table public.factures_lignes add column if not exists taux_tva numeric(5,2) not null default 20;

-- v1 -> v2 : la TVA devient un montant (montant_tva) pour gérer plusieurs taux par document
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'devis' and column_name = 'montant_tva') then
    drop view if exists public.v_clients_stats, public.v_factures, public.v_devis,
                        public.v_paiements, public.v_chantiers cascade;

    alter table public.devis drop column montant_ttc;
    alter table public.devis add column montant_tva numeric(12,2) not null default 0;
    update public.devis set montant_tva = round(montant_ht * taux_tva / 100, 2);
    alter table public.devis add column montant_ttc numeric(12,2) generated always as (montant_ht + montant_tva) stored;

    alter table public.factures drop column montant_ttc;
    alter table public.factures add column montant_tva numeric(12,2) not null default 0;
    update public.factures set montant_tva = round(montant_ht * taux_tva / 100, 2);
    alter table public.factures add column montant_ttc numeric(12,2) generated always as (montant_ht + montant_tva) stored;

    update public.devis_lignes l    set taux_tva = d.taux_tva from public.devis d    where d.id = l.devis_id;
    update public.factures_lignes l set taux_tva = f.taux_tva from public.factures f where f.id = l.facture_id;
  end if;
end $$;

create index if not exists clients_user_idx     on public.clients(user_id);
create index if not exists chantiers_client_idx on public.chantiers(client_id);
create index if not exists devis_client_idx     on public.devis(client_id);
create index if not exists factures_client_idx  on public.factures(client_id);
create index if not exists paiements_fact_idx   on public.paiements(facture_id);
create index if not exists depenses_user_idx    on public.depenses(user_id, date_depense);
create index if not exists notif_user_idx       on public.notifications(user_id, created_at desc);
create index if not exists partages_doc_idx     on public.partages(doc_id);

-- ---------- 3. SÉCURITÉ (RLS) ----------------------------------------
-- Chaque utilisateur ne voit et ne modifie QUE ses propres lignes.

do $$
declare t text;
begin
  foreach t in array array['entreprise','clients','chantiers','devis','devis_lignes',
                           'factures','factures_lignes','paiements','compteurs',
                           'depenses','documents_compta','notifications','partages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "proprietaire" on public.%I', t);
    execute format(
      'create policy "proprietaire" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.acces_comptable enable row level security;
drop policy if exists "proprietaire" on public.acces_comptable;
create policy "proprietaire" on public.acces_comptable for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "invite" on public.acces_comptable;
create policy "invite" on public.acces_comptable for select to authenticated
  using (lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), '')));

-- Le comptable invité peut LIRE (jamais écrire) les données du propriétaire
create or replace function public.est_comptable_de(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.acces_comptable a
    where a.owner_id = p_owner
      and lower(a.email) = lower(coalesce((select auth.jwt() ->> 'email'), '')));
$$;

create or replace function public.est_comptable_de_txt(p_owner text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.acces_comptable a
    where a.owner_id::text = p_owner
      and lower(a.email) = lower(coalesce((select auth.jwt() ->> 'email'), '')));
$$;

do $$
declare t text;
begin
  foreach t in array array['entreprise','clients','chantiers','devis','devis_lignes',
                           'factures','factures_lignes','paiements','depenses','documents_compta']
  loop
    execute format('drop policy if exists "comptable_lecture" on public.%I', t);
    execute format(
      'create policy "comptable_lecture" on public.%I for select to authenticated
         using (public.est_comptable_de(user_id))', t);
  end loop;
end $$;

-- ---------- 4. NUMÉROTATION AUTOMATIQUE : devis-001, facture-001 ------
-- Compteur continu (sans remise à zéro annuelle) : aucun numéro ne saute.

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

create or replace function public.fmt_numero(p_prefixe text, p_n int)
returns text language sql immutable as $$
  select p_prefixe || '-' || case when p_n < 1000 then lpad(p_n::text, 3, '0') else p_n::text end
$$;

create or replace function public.trg_numero_devis() returns trigger
language plpgsql as $$
begin
  if new.numero is null then
    new.numero := public.fmt_numero('devis', public.prochain_numero('devis', 0));
  end if;
  return new;
end $$;

-- Facture : le numéro est attribué à l'ÉMISSION (passage de Brouillon à Envoyée),
-- pas à la création : supprimer un brouillon ne crée donc jamais de trou dans la suite légale.
create or replace function public.trg_numero_facture() returns trigger
language plpgsql as $$
begin
  if new.statut <> 'Brouillon' and new.numero is null then
    new.numero := public.fmt_numero('facture', public.prochain_numero('facture', 0));
    -- à l'émission, la date d'émission devient celle du jour (l'échéance suit le même décalage)
    if tg_op = 'UPDATE' and old.statut = 'Brouillon' and new.date_emission < current_date then
      new.echeance := new.echeance + (current_date - new.date_emission);
      new.date_emission := current_date;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists numero_devis on public.devis;
create trigger numero_devis before insert on public.devis
  for each row execute function public.trg_numero_devis();

drop trigger if exists numero_facture on public.factures;
create trigger numero_facture before insert or update on public.factures
  for each row execute function public.trg_numero_facture();

-- ---------- 5. TOTAUX CALCULÉS À PARTIR DES LIGNES -------------------
-- montant_ht = somme des lignes ; montant_tva = somme de la TVA de chaque ligne.

create or replace function public.trg_total_devis() returns trigger
language plpgsql as $$
declare d uuid := coalesce(new.devis_id, old.devis_id);
begin
  update public.devis set
    montant_ht  = coalesce((select sum(round(quantite * prix_unitaire_ht, 2))
                            from public.devis_lignes where devis_id = d), 0),
    montant_tva = coalesce((select sum(round(round(quantite * prix_unitaire_ht, 2) * taux_tva / 100, 2))
                            from public.devis_lignes where devis_id = d), 0)
  where id = d;
  return null;
end $$;

create or replace function public.trg_total_facture() returns trigger
language plpgsql as $$
declare f uuid := coalesce(new.facture_id, old.facture_id);
begin
  update public.factures set
    montant_ht  = coalesce((select sum(round(quantite * prix_unitaire_ht, 2))
                            from public.factures_lignes where facture_id = f), 0),
    montant_tva = coalesce((select sum(round(round(quantite * prix_unitaire_ht, 2) * taux_tva / 100, 2))
                            from public.factures_lignes where facture_id = f), 0)
  where id = f;
  return null;
end $$;

drop trigger if exists total_devis on public.devis_lignes;
create trigger total_devis after insert or update or delete on public.devis_lignes
  for each row execute function public.trg_total_devis();

drop trigger if exists total_facture on public.factures_lignes;
create trigger total_facture after insert or update or delete on public.factures_lignes
  for each row execute function public.trg_total_facture();

-- Document sans ligne : la TVA se déduit de montant_ht x taux_tva
create or replace function public.trg_tva_devis_sans_lignes() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.devis_lignes where devis_id = new.id) then
    new.montant_tva := round(new.montant_ht * new.taux_tva / 100, 2);
  end if;
  return new;
end $$;

create or replace function public.trg_tva_facture_sans_lignes() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.factures_lignes where facture_id = new.id) then
    new.montant_tva := round(new.montant_ht * new.taux_tva / 100, 2);
  end if;
  return new;
end $$;

drop trigger if exists tva_devis on public.devis;
create trigger tva_devis before insert or update on public.devis
  for each row execute function public.trg_tva_devis_sans_lignes();

drop trigger if exists tva_facture on public.factures;
create trigger tva_facture before insert or update on public.factures
  for each row execute function public.trg_tva_facture_sans_lignes();

-- ---------- 6. FACTURES : VERROU LÉGAL + STATUT AUTOMATIQUE ----------

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
       new.montant_ht <> old.montant_ht or new.montant_tva <> old.montant_tva
       or new.client_id <> old.client_id or new.numero is distinct from old.numero
       or new.date_emission <> old.date_emission) then
    raise exception 'Facture % émise : montant, TVA, client, date et numéro sont verrouillés.', old.numero;
  end if;
  return new;
end $$;

drop trigger if exists verrou_facture on public.factures;
create trigger verrou_facture before update or delete on public.factures
  for each row execute function public.trg_verrou_facture();

-- Les lignes d'une facture émise ne bougent plus
create or replace function public.trg_verrou_lignes_facture() returns trigger
language plpgsql as $$
declare st text; fid uuid := coalesce(new.facture_id, old.facture_id);
begin
  select statut into st from public.factures where id = fid;
  if st is not null and st <> 'Brouillon' then
    raise exception 'Facture émise : ses lignes ne peuvent plus être modifiées.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists verrou_lignes_facture on public.factures_lignes;
create trigger verrou_lignes_facture before insert or update or delete on public.factures_lignes
  for each row execute function public.trg_verrou_lignes_facture();

-- Après chaque paiement : statut de la facture + notification
create or replace function public.trg_paiement() returns trigger
language plpgsql as $$
declare
  fid uuid := coalesce(new.facture_id, old.facture_id);
  f   public.factures;
  paye numeric;
  cli text;
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

  if tg_op = 'INSERT' then
    select nom into cli from public.clients where id = f.client_id;
    insert into public.notifications (user_id, type, titre, message, lien)
    values (new.user_id, 'paiement',
            'Paiement reçu : ' || replace(to_char(new.montant, 'FM999999990.00'), '.', ',') || ' €',
            f.numero || ' · ' || coalesce(cli, ''), '#/factures/' || f.id);
  end if;
  return null;
end $$;

drop trigger if exists paiement_statut on public.paiements;
create trigger paiement_statut after insert or update or delete on public.paiements
  for each row execute function public.trg_paiement();

-- Dépense payée : date de paiement par défaut
create or replace function public.trg_depense() returns trigger
language plpgsql as $$
begin
  if new.statut = 'Payée' and new.date_paiement is null then
    new.date_paiement := current_date;
  end if;
  if new.statut = 'À payer' then
    new.date_paiement := null;
  end if;
  return new;
end $$;

drop trigger if exists depense_defaut on public.depenses;
create trigger depense_defaut before insert or update on public.depenses
  for each row execute function public.trg_depense();

-- ---------- 7. ENREGISTREMENT ATOMIQUE D'UN DEVIS / D'UNE FACTURE -----
-- p = { id?, client_id, chantier_id?, date, echeance? (facture) | validite_jours? (devis),
--       notes?, lignes: [ {designation, quantite, unite, prix_unitaire_ht, taux_tva} ] }

create or replace function public.sauver_document(p_kind text, p jsonb)
returns uuid language plpgsql as $$
declare
  did uuid := nullif(p->>'id', '')::uuid;
  st text;
  l jsonb;
  i int := 0;
begin
  if p_kind not in ('devis','facture') then raise exception 'Type de document inconnu'; end if;
  if nullif(p->>'client_id','') is null then raise exception 'Choisissez un client.'; end if;

  if p_kind = 'devis' then
    if did is null then
      insert into public.devis (client_id, chantier_id, date_devis, validite_jours, notes)
      values ((p->>'client_id')::uuid, nullif(p->>'chantier_id','')::uuid,
              coalesce(nullif(p->>'date','')::date, current_date),
              coalesce(nullif(p->>'validite_jours','')::int, 30), nullif(p->>'notes',''))
      returning id into did;
    else
      select statut into st from public.devis where id = did;
      if st is null then raise exception 'Devis introuvable'; end if;
      if st <> 'Brouillon' then raise exception 'Seul un brouillon peut être modifié.'; end if;
      update public.devis set client_id = (p->>'client_id')::uuid,
        chantier_id = nullif(p->>'chantier_id','')::uuid,
        date_devis = coalesce(nullif(p->>'date','')::date, current_date),
        validite_jours = coalesce(nullif(p->>'validite_jours','')::int, 30),
        notes = nullif(p->>'notes','')
      where id = did;
      delete from public.devis_lignes where devis_id = did;
    end if;
    for l in select * from jsonb_array_elements(coalesce(p->'lignes', '[]'::jsonb)) loop
      i := i + 1;
      insert into public.devis_lignes (devis_id, position, designation, quantite, unite, prix_unitaire_ht, taux_tva)
      values (did, i, coalesce(nullif(l->>'designation',''), 'Prestation'),
              coalesce(nullif(l->>'quantite','')::numeric, 1), coalesce(nullif(l->>'unite',''), 'u'),
              coalesce(nullif(l->>'prix_unitaire_ht','')::numeric, 0),
              coalesce(nullif(l->>'taux_tva','')::numeric, 20));
    end loop;
  else
    if did is null then
      insert into public.factures (client_id, chantier_id, date_emission, echeance, notes)
      values ((p->>'client_id')::uuid, nullif(p->>'chantier_id','')::uuid,
              coalesce(nullif(p->>'date','')::date, current_date),
              coalesce(nullif(p->>'echeance','')::date, current_date + 30), nullif(p->>'notes',''))
      returning id into did;
    else
      select statut into st from public.factures where id = did;
      if st is null then raise exception 'Facture introuvable'; end if;
      if st <> 'Brouillon' then raise exception 'Seul un brouillon peut être modifié.'; end if;
      update public.factures set client_id = (p->>'client_id')::uuid,
        chantier_id = nullif(p->>'chantier_id','')::uuid,
        date_emission = coalesce(nullif(p->>'date','')::date, current_date),
        echeance = coalesce(nullif(p->>'echeance','')::date, current_date + 30),
        notes = nullif(p->>'notes','')
      where id = did;
      delete from public.factures_lignes where facture_id = did;
    end if;
    for l in select * from jsonb_array_elements(coalesce(p->'lignes', '[]'::jsonb)) loop
      i := i + 1;
      insert into public.factures_lignes (facture_id, position, designation, quantite, unite, prix_unitaire_ht, taux_tva)
      values (did, i, coalesce(nullif(l->>'designation',''), 'Prestation'),
              coalesce(nullif(l->>'quantite','')::numeric, 1), coalesce(nullif(l->>'unite',''), 'u'),
              coalesce(nullif(l->>'prix_unitaire_ht','')::numeric, 0),
              coalesce(nullif(l->>'taux_tva','')::numeric, 20));
    end loop;
  end if;
  return did;
end $$;

-- ---------- 8. DEVIS -> FACTURE EN UN CLIC ---------------------------

create or replace function public.devis_vers_facture(p_devis uuid)
returns uuid language plpgsql as $$
declare
  d public.devis;
  delai int;
  fid uuid;
begin
  select * into d from public.devis where id = p_devis;
  if not found then raise exception 'Devis introuvable'; end if;
  if exists (select 1 from public.factures where devis_id = p_devis and statut <> 'Annulée') then
    raise exception 'Ce devis a déjà été transformé en facture.';
  end if;
  select coalesce(delai_paiement_jours, 30) into delai from public.entreprise where user_id = auth.uid();

  insert into public.factures (client_id, chantier_id, devis_id, echeance, taux_tva, notes)
  values (d.client_id, d.chantier_id, d.id, current_date + coalesce(delai, 30), d.taux_tva, d.notes)
  returning id into fid;

  insert into public.factures_lignes (facture_id, position, designation, quantite, unite, prix_unitaire_ht, taux_tva)
  select fid, position, designation, quantite, unite, prix_unitaire_ht, taux_tva
  from public.devis_lignes where devis_id = d.id order by position;

  if not exists (select 1 from public.devis_lignes where devis_id = d.id) and d.montant_ht > 0 then
    update public.factures set montant_ht = d.montant_ht where id = fid;
  end if;

  update public.devis set statut = 'Accepté' where id = d.id and statut in ('Brouillon','Envoyé');
  return fid;
end $$;

-- ---------- 9. PARTAGE EN LIGNE (page publique p.html?t=...) ---------
-- Fonctions SECURITY DEFINER : seules portes ouvertes aux visiteurs non connectés.

create or replace function public.partage_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.partages;
  out jsonb;
  e public.entreprise;
begin
  select * into s from public.partages where token = p_token;
  if not found then return null; end if;
  select * into e from public.entreprise where user_id = s.user_id;

  if s.type = 'devis' then
    select jsonb_build_object('numero', d.numero, 'statut', d.statut, 'date', d.date_devis,
             'montant_ht', d.montant_ht, 'montant_ttc', d.montant_ttc,
             'client', c.nom, 'validite_jours', d.validite_jours)
      into out
      from public.devis d join public.clients c on c.id = d.client_id where d.id = s.doc_id;
  else
    select jsonb_build_object('numero', f.numero, 'statut', f.statut, 'date', f.date_emission,
             'echeance', f.echeance, 'montant_ht', f.montant_ht, 'montant_ttc', f.montant_ttc,
             'client', c.nom,
             'reste', f.montant_ttc - coalesce((select sum(montant) from public.paiements where facture_id = f.id), 0))
      into out
      from public.factures f join public.clients c on c.id = f.client_id where f.id = s.doc_id;
  end if;
  if out is null then return null; end if;

  if s.vu_at is null then
    update public.partages set vu_at = now() where token = p_token;
    insert into public.notifications (user_id, type, titre, message, lien)
    values (s.user_id, 'consultation',
            initcap(s.type) || ' ' || (out->>'numero') || ' consulté',
            (out->>'client') || ' a ouvert le document en ligne.',
            '#/' || case when s.type = 'devis' then 'devis' else 'factures' end || '/' || s.doc_id);
  end if;

  return out || jsonb_build_object(
    'type', s.type, 'pdf_path', s.pdf_path,
    'accepte_at', s.accepte_at, 'accepte_par', s.accepte_par, 'refuse_at', s.refuse_at,
    'entreprise', jsonb_build_object('nom', e.nom, 'email', e.email, 'telephone', e.telephone,
                                     'iban', e.iban, 'bic', e.bic));
end $$;

create or replace function public.partage_accepter(p_token uuid, p_nom text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.partages; st text; num text; cli text;
begin
  select * into s from public.partages where token = p_token and type = 'devis';
  if not found then raise exception 'Lien invalide.'; end if;
  if coalesce(trim(p_nom), '') = '' then raise exception 'Indiquez votre nom pour accepter.'; end if;
  select d.statut, d.numero, c.nom into st, num, cli
    from public.devis d join public.clients c on c.id = d.client_id where d.id = s.doc_id;
  if st = 'Accepté' then return jsonb_build_object('ok', true, 'deja', true); end if;
  if st <> 'Envoyé' then raise exception 'Ce devis ne peut plus être accepté en ligne.'; end if;

  update public.devis set statut = 'Accepté' where id = s.doc_id;
  update public.partages set accepte_at = now(), accepte_par = left(trim(p_nom), 120) where token = p_token;
  insert into public.notifications (user_id, type, titre, message, lien)
  values (s.user_id, 'devis_accepte', 'Devis ' || num || ' accepté',
          cli || ' · accepté en ligne par ' || left(trim(p_nom), 120), '#/devis/' || s.doc_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.partage_refuser(p_token uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.partages; st text; num text; cli text;
begin
  select * into s from public.partages where token = p_token and type = 'devis';
  if not found then raise exception 'Lien invalide.'; end if;
  select d.statut, d.numero, c.nom into st, num, cli
    from public.devis d join public.clients c on c.id = d.client_id where d.id = s.doc_id;
  if st <> 'Envoyé' then raise exception 'Ce devis ne peut plus être refusé en ligne.'; end if;

  update public.devis set statut = 'Refusé' where id = s.doc_id;
  update public.partages set refuse_at = now(), refuse_motif = left(coalesce(p_motif, ''), 500) where token = p_token;
  insert into public.notifications (user_id, type, titre, message, lien)
  values (s.user_id, 'devis_refuse', 'Devis ' || num || ' refusé',
          cli || ' a refusé le devis en ligne.', '#/devis/' || s.doc_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 9 bis. ALERTES DE RETARD (appelée à l'ouverture de l'appli, sans doublon)

create or replace function public.generer_alertes() returns int
language plpgsql as $$
declare n int := 0; r record;
begin
  for r in
    select f.id, f.numero, c.nom as client, f.echeance
    from public.factures f join public.clients c on c.id = f.client_id
    where f.statut in ('Envoyée','Partiellement payée') and f.echeance < current_date
  loop
    insert into public.notifications (user_id, type, titre, message, lien, cle)
    values (auth.uid(), 'retard', 'Facture en retard : ' || r.numero,
            r.client || ' · échue le ' || to_char(r.echeance, 'DD/MM/YYYY'), '#/factures/' || r.id, 'retard:' || r.id)
    on conflict (user_id, cle) where cle is not null do nothing;
    if found then n := n + 1; end if;
  end loop;
  for r in
    select id, fournisseur, echeance from public.depenses
    where statut = 'À payer' and echeance is not null and echeance < current_date
  loop
    insert into public.notifications (user_id, type, titre, message, lien, cle)
    values (auth.uid(), 'retard', 'Facture fournisseur à payer',
            r.fournisseur || ' · échue le ' || to_char(r.echeance, 'DD/MM/YYYY'), '#/depenses/' || r.id, 'depretard:' || r.id)
    on conflict (user_id, cle) where cle is not null do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------- 10. VUES DE LECTURE (utilisées par l'appli) --------------
-- security_invoker = les règles RLS de l'utilisateur s'appliquent aussi aux vues.

drop view if exists public.v_clients_stats, public.v_factures, public.v_devis,
                    public.v_paiements, public.v_chantiers, public.v_depenses cascade;

create view public.v_chantiers with (security_invoker = true) as
select ch.*, c.nom as client_nom
from public.chantiers ch join public.clients c on c.id = ch.client_id;

create view public.v_devis with (security_invoker = true) as
select d.*, c.nom as client_nom, ch.nom as chantier_nom
from public.devis d
join public.clients c on c.id = d.client_id
left join public.chantiers ch on ch.id = d.chantier_id;

create view public.v_factures with (security_invoker = true) as
select f.*, c.nom as client_nom, ch.nom as chantier_nom,
       coalesce(p.paye, 0)                          as paye,
       f.montant_ttc - coalesce(p.paye, 0)          as reste,
       case when f.statut in ('Envoyée','Partiellement payée') and f.echeance < current_date
            then 'En retard' else f.statut end      as statut_affiche
from public.factures f
join public.clients c on c.id = f.client_id
left join public.chantiers ch on ch.id = f.chantier_id
left join lateral (select sum(montant) as paye from public.paiements where facture_id = f.id) p on true;

create view public.v_paiements with (security_invoker = true) as
select p.*, f.numero as facture_numero, c.nom as client_nom
from public.paiements p
join public.factures f on f.id = p.facture_id
join public.clients c on c.id = f.client_id;

create view public.v_depenses with (security_invoker = true) as
select d.*, ch.nom as chantier_nom
from public.depenses d left join public.chantiers ch on ch.id = d.chantier_id;

create view public.v_clients_stats with (security_invoker = true) as
select c.*,
  (select count(*) from public.chantiers ch where ch.client_id = c.id)                       as nb_chantiers,
  coalesce((select sum(f.montant_ht) from public.factures f
            where f.client_id = c.id and f.statut not in ('Brouillon','Annulée')), 0)        as ca,
  coalesce((select sum(f.reste) from public.v_factures f
            where f.client_id = c.id and f.statut not in ('Brouillon','Annulée')), 0)        as a_encaisser
from public.clients c;

-- ---------- 11. STOCKAGE DES FICHIERS --------------------------------
-- "documents" : privé (justificatifs, relevés, modèles, logo). Dossier = <user_id>/...
-- "partages"  : public (PDF envoyés aux clients, noms impossibles à deviner).

insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('partages', 'partages', true)
on conflict (id) do nothing;

drop policy if exists "documents_proprietaire" on storage.objects;
create policy "documents_proprietaire" on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "documents_comptable" on storage.objects;
create policy "documents_comptable" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.est_comptable_de_txt((storage.foldername(name))[1]));

drop policy if exists "partages_proprietaire" on storage.objects;
create policy "partages_proprietaire" on storage.objects for all to authenticated
  using (bucket_id = 'partages' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'partages' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- 12. DROITS D'EXÉCUTION ET TEMPS RÉEL ---------------------

revoke execute on function public.prochain_numero(text, int)  from public, anon;
revoke execute on function public.sauver_document(text, jsonb) from public, anon;
revoke execute on function public.devis_vers_facture(uuid)    from public, anon;
revoke execute on function public.generer_alertes() from public, anon;
grant  execute on function public.generer_alertes() to authenticated;
grant  execute on function public.prochain_numero(text, int)  to authenticated;
grant  execute on function public.sauver_document(text, jsonb) to authenticated;
grant  execute on function public.devis_vers_facture(uuid)    to authenticated;
grant  execute on function public.est_comptable_de(uuid), public.est_comptable_de_txt(text) to authenticated;
grant  execute on function public.partage_get(uuid), public.partage_accepter(uuid, text),
                           public.partage_refuser(uuid, text) to anon, authenticated;

-- Les visiteurs non connectés n'ont accès à aucune table
revoke all on all tables in schema public from anon;

-- Notifications en temps réel (la cloche se met à jour sans recharger)
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null;
end $$;
