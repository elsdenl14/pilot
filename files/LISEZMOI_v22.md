# Pilot v22 : risques et rentabilité prédictive

Aucune migration. Tout est calculé dans le navigateur à partir de vos données (budgets, dépenses, heures, planning, affectations, pointages).

## Où le trouver
- **Pilotage > Risques et prévisions** (page complète, 4 onglets : Chantiers · Dépenses atypiques · Heures supplémentaires · Méthode).
- **Fiche chantier** : carte « Risques et prévisions » sous le tableau de bord, avec le détail du calcul.
- **Accueil** : bloc « Chantiers à risque » (à activer dans Personnaliser) et alertes dans « À traiter ».
- **Assistant IA** : reçoit un résumé des prévisions.
- Réservé aux profils ayant la permission « Marges » ; l'onglet Dépenses demande « Achats », l'onglet Heures « Salaires et pointages ».

## Ce que chaque indicateur annonce
- **Risque de dépassement du budget** : coût final estimé (coûts réels + engagements, ramenés à l'avancement) comparé au budget.
- **Risque de retard** : rythme actuel projeté jusqu'à la fin, plus phases et tâches échues ou bloquées. Donne la date de fin projetée.
- **Marge finale estimée** : marché − coût final estimé, brute et nette des frais généraux, avec un scénario pessimiste.
- **Dépenses anormalement élevées** : écart statistique à la norme de la catégorie ou du fournisseur, doublons probables, poids dans le budget d'une ligne, pics de dépenses d'un chantier.
- **Heures supplémentaires prévisibles** : par salarié (planning ou moyenne des 3 dernières semaines contre le seuil de vos réglages, majorations estimées) et par chantier (heures restantes contre la capacité des salariés affectés).
- **Chantiers qui risquent d'être déficitaires** : « Déficit prévu » (marge nette finale négative), « À risque » (négative en scénario pessimiste ou sous 5 %).
Le risque global (faible, modéré, élevé, critique) combine le pire indicateur et la moyenne.

## Limites
- Projection linéaire : fiable seulement si l'avancement, les budgets, les heures et les dates sont à jour. Sans avancement, sans budget ou sans dates, l'indicateur concerné est « non évaluable » et non faussement rassurant.
- Les seuils (97 % du budget = risque nul, 115 % = critique, 5 % de marge nette, écart statistique 3,5, montant minimum 150 €) sont des choix de gestion à ajuster selon votre métier ; ils se règlent en tête de `views-risques.js`.
- Les dépenses signalées sont à vérifier, pas des erreurs avérées. Les heures supplémentaires sont une estimation de gestion, pas un calcul de paie.
- Testé avec une base factice (chantier à la dérive, chantier sain, chantier sans données, dépense atypique, doublon, heures supplémentaires, permissions), pas sur vos données réelles.

## Installation
Copiez les 6 fichiers par-dessus votre projet (`views-risques.js` est nouveau). Modifiés : `index.html`, `app.js`, `nav.js`, `views-activite.js`, `views-chantier-pro.js`.
