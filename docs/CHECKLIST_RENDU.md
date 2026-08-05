# Checklist de rendu

## Livrables dans le depot

- [x] Code de la Todo API Node/Express.
- [x] Stats API FastAPI.
- [x] Dockerfile de production pour `todo-api`.
- [x] Dockerfile de `stats-api`.
- [x] Tests unitaires.
- [x] Tests d'integration avec PostgreSQL.
- [x] Workflow GitHub Actions principal : `.github/workflows/ci-cd.yml`.
- [x] Workflow manuel de rollback : `.github/workflows/rollback.yml`.
- [x] Carte de traduction GitLab-CI : `.gitlab-ci.yml`.
- [x] `Dockerfile.vm` pour documenter la machine cible.
- [x] Compose de production : `deploy/compose.yml`.
- [x] Configuration Prometheus : `deploy/prometheus.yml`.
- [x] Regles d'alerte Prometheus : `deploy/alerts.yml`.
- [x] Provisioning Grafana.
- [x] Dashboard Grafana JSON : `deploy/grafana/dashboards/todo-api-overview.json`.
- [x] Procedure de deploiement : `docs/PROCEDURE_DEPLOIEMENT.md`.
- [x] Guide de configuration GitHub Actions : `docs/CONFIGURATION_GITHUB_ACTIONS.md`.
- [x] Script d'incident : `scripts/incident.sh`.
- [x] `.gitignore` protege `.env`, cles privees et fichiers generes.

## Verifications deja faites

- [x] GitHub Actions vert sur `main`.
- [x] Tests GitHub Actions avec PostgreSQL de service.
- [x] Build Docker GitHub Actions vert.
- [x] Deploy GitHub Actions saute proprement sans secrets Docker Hub.
- [x] `npm test` local passe contre PostgreSQL.
- [x] `docker compose -f deploy/compose.yml config` valide.
- [x] `promtool check config` valide `prometheus.yml` et `alerts.yml`.
- [x] Scan local sans cle privee ou secret evident versionne.

## A faire sur machine cible

- [ ] Creer les secrets GitHub Actions :
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`
  - `DEPLOY_SSH_KEY`
  - `DEPLOY_HOST`
  - `DEPLOY_PORT`
  - `DEPLOY_USER`
- [ ] Preparer `/srv/todo/.env` sur la machine cible.
- [ ] Installer ou demarrer le runner self-hosted.
- [ ] Faire un push sur `main` avec secrets actifs.
- [ ] Verifier `/health`.
- [ ] Verifier `/metrics`.
- [ ] Verifier Prometheus `up{job="todo-api"}`.
- [ ] Verifier le dashboard Grafana.
- [ ] Remplir le tableau de mesures Grafana dans le README.
- [ ] Chronometrer un rollback.
- [ ] Lancer la passation avec `scripts/incident.sh`.
- [ ] Completer les notes de passation dans le README.

## Grille d'evaluation

| Critere | Etat |
|---|---|
| Deploiement automatise | Pret cote depot, a valider avec secrets et runner |
| Surveillance | Pret cote depot, a valider sur machine cible |
| Procedure de deploiement | Redigee, a tester par un tiers |
| Tests d'integration | Presents et verts |
| Journal de bord | Structure presente, mesures reelles a completer |
| Rigueur du depot | Commits atomiques, `.gitignore` renforce, pas de secret detecte |
