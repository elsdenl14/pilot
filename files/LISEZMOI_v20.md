# Pilot v20 – Carte interactive des chantiers

1. Exécuter `migration_v18.sql` dans Supabase (table `chantier_geo` + RLS).
2. Publier aussi le dossier `vendor/leaflet/` (sinon Leaflet est chargé depuis un CDN).
3. Menu **Carte** : marqueurs avec anneau d'avancement (%), maison qui se construit selon l'avancement, pastille du métier, couleur selon l'état (dans les temps / à surveiller / alerte / terminé). Clic = fiche détaillée (budget, marge, heures, reste à facturer).
4. Le métier est deviné d'après le nom/les notes du chantier, modifiable dans la fiche.
5. Les chantiers sans position sont géolocalisés automatiquement via leur adresse (api-adresse.data.gouv.fr). Fonds de carte OpenStreetMap : internet requis.
6. Lien direct : `#/carte?c=<id_chantier>`.
