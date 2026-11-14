-- Pilot v13 : Chiffrage avancé & études de prix
-- À lancer une seule fois dans Supabase > SQL Editor (peut être relancé sans risque).

-- 1. Lignes de devis : déboursés, métré, options, images
alter table public.devis_lignes
  add column if not exists type_ligne      text    not null default 'normale',  -- 'normale' | 'image'
  add column if not exists image_path      text,
  add column if not exists chiffrage       jsonb,                                -- déboursés unitaires + coefficient
  add column if not exists debourse_ht     numeric(12,2),                        -- coût de revient unitaire (interne)
  add column if not exists metre           text,                                 -- formule de métré
  add column if not exists est_option      boolean not null default false,
  add column if not exists option_choisie  boolean not null default false,
  add column if not exists option_groupe   text;                                 -- variantes exclusives : même groupe = un seul choix

alter table public.factures_lignes
  add column if not exists debourse_ht numeric(12,2);

-- 2. Réglages de l'entreprise pour le coefficient de vente
alter table public.entreprise
  add column if not exists chiffrage_reglages jsonb;
  -- { frais_fixes_annuels, ca_cible, frais_generaux_pct, benefice_pct, coef_st, taux_mo_cout, taux_mo_vente }

-- 3. Ouvrages composés : sous-détail de prix
alter table public.ouvrages add column if not exists debourse_ht numeric(12,2);
create table if not exists public.ouvrage_composants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ouvrage_id  uuid not null references public.ouvrages(id) on delete cascade,
  position    int  not null default 1,
  type        text not null check (type in ('materiau','main_oeuvre','materiel','sous_traitance')),
  designation text not null default '',
  quantite    numeric(12,3) not null default 1,
  unite       text not null default 'u',
  cout_unitaire numeric(12,2) not null default 0
);
create index if not exists ouvrage_composants_idx on public.ouvrage_composants (ouvrage_id);
alter table public.ouvrage_composants enable row level security;
drop policy if exists own on public.ouvrage_composants;
create policy own on public.ouvrage_composants for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. Totaux du devis : on ignore les images et les options non retenues
create or replace function public.trg_total_devis() returns trigger
language plpgsql as $$
declare d uuid := coalesce(new.devis_id, old.devis_id);
begin
  update public.devis set
    montant_ht  = coalesce((select sum(round(quantite * prix_unitaire_ht, 2))
                            from public.devis_lignes
                            where devis_id = d and type_ligne = 'normale' and (not est_option or option_choisie)), 0),
    montant_tva = coalesce((select sum(round(round(quantite * prix_unitaire_ht, 2) * taux_tva / 100, 2))
                            from public.devis_lignes
                            where devis_id = d and type_ligne = 'normale' and (not est_option or option_choisie)), 0)
  where id = d;
  return null;
end $$;

-- 5. Devis -> facture : sans images ni options non retenues
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
  select fid, row_number() over (order by position), designation, quantite, unite, prix_unitaire_ht, taux_tva
  from public.devis_lignes
  where devis_id = d.id and type_ligne = 'normale' and (not est_option or option_choisie)
  order by position;

  if not exists (select 1 from public.devis_lignes where devis_id = d.id) and d.montant_ht > 0 then
    update public.factures set montant_ht = d.montant_ht where id = fid;
  end if;

  update public.devis set statut = 'Accepté' where id = d.id and statut in ('Brouillon','Envoyé');
  return fid;
end $$;

-- 6. Page client : options proposées / choix (aucun déboursé n'est jamais renvoyé)
create or replace function public.partage_options_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.partages; d public.devis; out jsonb;
begin
  select * into s from public.partages where token = p_token and type = 'devis';
  if not found then raise exception 'Lien invalide.'; end if;
  select * into d from public.devis where id = s.doc_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'designation', l.designation, 'quantite', l.quantite, 'unite', l.unite,
      'prix_unitaire_ht', l.prix_unitaire_ht, 'taux_tva', l.taux_tva,
      'groupe', l.option_groupe, 'choisie', l.option_choisie) order by l.position), '[]'::jsonb)
    into out
  from public.devis_lignes l where l.devis_id = d.id and l.est_option and l.type_ligne = 'normale';
  return jsonb_build_object('options', out, 'statut', d.statut,
    'montant_ht', d.montant_ht, 'montant_tva', d.montant_tva, 'montant_ttc', d.montant_ht + d.montant_tva);
end $$;

create or replace function public.partage_options(p_token uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.partages; d public.devis; g record;
begin
  select * into s from public.partages where token = p_token and type = 'devis';
  if not found then raise exception 'Lien invalide.'; end if;
  select * into d from public.devis where id = s.doc_id;
  if d.statut <> 'Envoyé' then raise exception 'Ce devis ne peut plus être modifié.'; end if;
  -- variantes exclusives : un seul choix par groupe
  for g in select option_groupe from public.devis_lignes
           where devis_id = d.id and est_option and option_groupe is not null and option_groupe <> ''
             and id = any(coalesce(p_ids, '{}')) group by option_groupe having count(*) > 1 loop
    raise exception 'Choisissez une seule variante pour « % ».', g.option_groupe;
  end loop;
  update public.devis_lignes set option_choisie = (id = any(coalesce(p_ids, '{}')))
   where devis_id = d.id and est_option;
  return public.partage_options_get(p_token);
end $$;

revoke execute on function public.partage_options_get(uuid), public.partage_options(uuid, uuid[]) from public;
grant  execute on function public.partage_options_get(uuid), public.partage_options(uuid, uuid[]) to anon, authenticated;
