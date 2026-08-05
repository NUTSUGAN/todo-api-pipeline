# Procedure de deploiement Todo API

Cette procedure sert a deployer ou retablir la Todo API sur la machine cible.
Elle doit etre suivie sans modifier les fichiers directement en production, sauf
pour le fichier `/srv/todo/.env` qui contient les secrets runtime.

## 1. Informations a avoir sous la main

- Depot GitHub : `https://github.com/NUTSUGAN/todo-api-pipeline`
- Dossier de production sur la machine cible : `/srv/todo`
- Compose de production : `/srv/todo/compose.yml`
- API : `http://localhost:3000`
- Grafana : `http://localhost:3001`
- Prometheus : `http://localhost:9090`
- Images Docker attendues :
  - `nutsugan/todo-api:<sha>`
  - `nutsugan/stats-api:<sha>`

Secrets GitHub Actions requis :

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `DEPLOY_SSH_KEY`
- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`

Variables GitHub Actions optionnelles :

- `DOCKER_IMAGE_NAMESPACE`, si le namespace Docker Hub n'est pas le meme que
  `DOCKERHUB_USERNAME`.

Sans `DOCKERHUB_USERNAME` et `DOCKERHUB_TOKEN`, la pipeline lance les tests et
construit les images localement dans le runner, mais ne pousse pas sur Docker
Hub et ne deploie pas. C'est volontaire : un repo fraichement cree doit rester
vert tant que les secrets de production ne sont pas encore branches.

Le fichier `.gitlab-ci.yml` fournit la meme logique en syntaxe GitLab-CI :
stages `test`, `build`, `deploy`, PostgreSQL en service de test, Docker-in-Docker
pour le build, puis deploiement manuel par SSH.

Fichier `/srv/todo/.env` requis sur la machine cible :

```env
PGPASSWORD=<mot-de-passe-postgres>
POSTGRES_PASSWORD=<mot-de-passe-postgres>
DB_PASSWORD=<mot-de-passe-postgres>
```

## 2. Deploiement normal par la pipeline

1. Pousser un commit sur `main`.

   Verification attendue : le workflow `CI/CD` demarre dans l'onglet Actions.

2. Attendre le job `Unit and integration tests`.

   Verification attendue : `npm test` passe avec PostgreSQL lance en service.

3. Attendre le job `Build Docker images`.

   Verification attendue : les images `todo-api:<sha>` et `stats-api:<sha>`
   sont construites, puis poussees sur Docker Hub si la branche est `main`.

4. Attendre le job `Deploy production`.

   Verification attendue : le job tourne sur le runner `self-hosted`, copie
   `deploy/compose.yml`, `deploy/prometheus.yml` et les fichiers Grafana dans
   `/srv/todo`, puis execute `docker compose up -d`.

5. Verifier que l'API repond.

   ```sh
   ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
     'curl -fsS http://localhost:3000/health'
   ```

   Resultat attendu :

   ```json
   {"status":"ok","timestamp":"..."}
   ```

6. Verifier que Prometheus collecte l'API.

   ```sh
   ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
     'curl -fsS "http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22todo-api%22%7D"'
   ```

   Resultat attendu : la valeur `up{job="todo-api"}` vaut `1`.

7. Verifier Grafana.

   Ouvrir `http://localhost:3001`, puis le dashboard
   `Todo API - Golden Signals`.

   Resultat attendu : le panneau `Disponibilite` vaut `1`.

## 3. Commande de deploiement manuel

Utiliser cette commande seulement pour retablir le service ou rejouer une
version precise.

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'cd /srv/todo && DOCKER_IMAGE_NAMESPACE=nutsugan TAG=<sha> docker compose -f compose.yml pull && DOCKER_IMAGE_NAMESPACE=nutsugan TAG=<sha> docker compose -f compose.yml up -d --remove-orphans'
```

Verification attendue :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
```

Les conteneurs `todo-api`, `stats-api`, `todo-db`, `prometheus` et `grafana`
doivent etre `Up`.

## 4. Retour arriere

Declencher un retour arriere si :

- `/health` ne repond plus apres un deploiement,
- le taux de `5xx` monte fortement dans Grafana,
- une regression visible est constatee sur une route critique,
- le responsable du deploiement decide de retablir la derniere version saine.

Option recommandee si GitHub Actions et le runner self-hosted sont disponibles :

1. Ouvrir `Actions > Rollback production`.
2. Cliquer sur `Run workflow`.
3. Renseigner `target_sha` avec le SHA sain a redeployer.
4. Laisser `image_namespace` vide sauf si les images ne sont pas dans le
   namespace Docker Hub par defaut.
5. Lancer le workflow.

Verification attendue : le job `Verify rollback` affiche `/health` puis
l'image `todo-api` terminee par `:<target_sha>`.

Commande :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'cd /srv/todo && DOCKER_IMAGE_NAMESPACE=nutsugan TAG=<sha-precedent> docker compose -f compose.yml pull && DOCKER_IMAGE_NAMESPACE=nutsugan TAG=<sha-precedent> docker compose -f compose.yml up -d --remove-orphans'
```

Verification apres retour arriere :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'curl -fsS http://localhost:3000/health && docker inspect -f "{{.Config.Image}}" todo-api'
```

Resultat attendu : `/health` repond et l'image affiche le SHA precedent.

Si le tag n'existe pas sur Docker Hub, `docker compose pull` echoue avant de
remplacer les conteneurs. Dans ce cas, ne pas faire `docker compose down`.
Choisir un autre SHA connu et relancer la commande de retour arriere.

## 5. Releves Grafana

Remplir ce tableau dans le README pendant l'exercice :

| Moment | up | Requetes/s | Taux d'erreur | p95 |
|---|---:|---:|---:|---:|
| Au repos, avant la boucle de charge | A mesurer | A mesurer | A mesurer | A mesurer |
| Pendant la boucle de charge | A mesurer | A mesurer | A mesurer | A mesurer |
| Pendant l'incident | A mesurer | A mesurer | A mesurer | A mesurer |

Requetes PromQL du dashboard :

- Disponibilite : `up{job="todo-api"}`
- Trafic : `sum(rate(http_requests_total[1m]))`
- Erreurs : `sum(rate(http_requests_total{status=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))`
- Latence p95 : `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`
- Metier : `tasks_in_database`

## 6. Pannes connues et signatures

Pour l'exercice de passation, le script versionne `scripts/incident.sh` peut
etre lance sur la machine cible par un encadrant ou un binome :

```sh
ssh -p <DEPLOY_PORT> root@<DEPLOY_HOST> 'sh -s' < scripts/incident.sh
```

Ne pas lire `/root/.incident` avant le debriefing.

| Panne | Signature dashboard | Commandes de diagnostic | Correction |
|---|---|---|---|
| `todo-api` arretee | `up` passe a `0`, trafic a `0` | `docker ps -a`, `docker logs todo-api --tail=80` | Rejouer le deploiement avec le dernier SHA sain |
| `todo-db` arretee | `up` reste a `1`, erreurs `5xx` montent | `docker ps -a`, `docker logs todo-api --tail=80`, `docker logs todo-db --tail=80` | `docker start todo-db`, puis verifier `/api/tasks` |
| API deconnectee du network | `up` peut rester a `1`, routes DB en `5xx` | `docker inspect todo-api`, `docker network ls` | Rejouer `docker compose -f compose.yml up -d` |
| API relancee sans configuration | `/health` peut repondre, `/api/tasks` echoue | `docker inspect todo-api`, verifier `Env` | Rejouer le deploiement compose |
| Machine surchargee | Grafana lent, p95 monte, commandes lentes | `docker stats`, `docker ps` | Arreter les conteneurs parasites, puis verifier les golden signals |
| Port 3000 deja occupe | Deploy echoue avec `port is already allocated` | `docker ps --format "table {{.Names}}\t{{.Ports}}"` | Identifier le conteneur occupant, demander validation avant arret |

## 7. Commandes utiles

Afficher les conteneurs :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'
```

Lire les logs de l'API :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'docker logs todo-api --tail=120'
```

Tester les routes principales :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'curl -fsS http://localhost:3000/health && curl -fsS http://localhost:3000/api/tasks'
```

Generer du trafic :

```sh
while true; do
  curl -s http://localhost:3000/api/tasks > /dev/null
  curl -s -X POST http://localhost:3000/api/tasks \
    -H 'Content-Type: application/json' \
    -d '{"description":"charge"}' > /dev/null
  curl -s http://localhost:3000/api/tasks/inexistant > /dev/null
  sleep 0.2
done
```

Temps attendu :

- Deploiement normal : a mesurer lors du premier passage complet.
- Retour arriere : a mesurer pendant l'exercice de rollback.
