# todo-api-pipeline

Todo API conteneurisee avec Node/Express, PostgreSQL, une stats-api FastAPI,
une pipeline CI/CD, un deploiement Docker Compose et une supervision
Prometheus/Grafana.

## Lancer les tests

Les tests d'integration ont besoin d'un PostgreSQL accessible.

```bash
docker run -d --rm --name todo-api-test-postgres \
  -e POSTGRES_DB=todo_test \
  -e POSTGRES_USER=todo \
  -e POSTGRES_PASSWORD=todo_pw \
  -p 5433:5432 \
  postgres:16-alpine

PGHOST=127.0.0.1 \
PGPORT=5433 \
PGUSER=todo \
PGPASSWORD=todo_pw \
PGDATABASE=todo_test \
npm test
```

## Deploiement et monitoring

- Workflow principal : `.github/workflows/ci-cd.yml`
- Rollback manuel : `.github/workflows/rollback.yml`
- Equivalence GitLab-CI : `.gitlab-ci.yml`
- Manifests Kubernetes : `k8s/`
- Compose de production : `deploy/compose.yml`
- Configuration Prometheus : `deploy/prometheus.yml`
- Regles d'alerte Prometheus : `deploy/alerts.yml`
- Dashboard Grafana : `deploy/grafana/dashboards/todo-api-overview.json`
- Procedure : `docs/PROCEDURE_DEPLOIEMENT.md`
- Configuration GitHub Actions : `docs/CONFIGURATION_GITHUB_ACTIONS.md`
- Checklist de rendu : `docs/CHECKLIST_RENDU.md`

## Journal de bord

### Kubernetes local, rollout et resilience (2026-08-06)

Le deploiement cible maintenant le cluster Kubernetes local `todo-cluster`.
Les manifests sont versionnes dans `k8s/` : Namespace, Deployment, Service,
ConfigMap, Secret d'exercice, PostgreSQL avec PVC, Ingress Traefik et probes
HTTP sur `/health`. Le job `Deploy Kubernetes` de GitHub Actions n'utilise plus
SSH : il applique les manifests non sensibles, met a jour l'image
`todo-api:<sha>` dans le Deployment, puis bloque sur `kubectl rollout status`.

**Comparaison de deploiement a completer pendant l'exercice :**

| Deploiement | Requetes echouees | Secondes d'indisponibilite | Temps de convergence totale |
|---|---:|---:|---:|
| Hier, SSH manuel | A renseigner | A renseigner | A renseigner |
| Aujourd'hui, rolling update | 0 | 0 | 25 s |

**Verifications cluster realisees :**
- `kubectl get pods -n todo` : trois pods `todo-api` et un pod `todo-db` en
  `Running`, colonne `READY` a `1/1` ;
- variables runtime injectees depuis `todo-config` et `todo-secret` :
  `NODE_ENV`, `PORT`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
  `PGDATABASE` presentes dans le conteneur ;
- suppression d'un pod `todo-api` : un nouveau pod a ete recree
  automatiquement par le ReplicaSet ;
- persistance PostgreSQL : une tache creee via l'API est restee presente
  apres suppression et recreation du pod `todo-db` ;
- Docker Desktop `kind` : `k8s/traefik-dev.yaml` installe un controleur
  Traefik local, puis `curl -H "Host: todo.localhost"
  http://localhost:8080/health` repond `ok`.

**Repartition du trafic entre replicas :**

Charge lancee via l'Ingress Docker Desktop pendant 20 secondes :

```text
Total : 52 requetes, 0 echouees (code != 200)
```

Compteurs `http_requests_total` lus directement sur chaque pod, en contournant
le Service par `kubectl port-forward pod/<pod> 3001:3000` :

| Pod | `GET /api/tasks` apres charge |
|---|---:|
| `todo-api-65fbb44fb7-hbfqt` | 19 |
| `todo-api-65fbb44fb7-krhrl` | 17 |
| `todo-api-65fbb44fb7-n4cbd` | 18 |

Les trois pods ont recu du trafic dans le meme ordre de grandeur : le Service
ne pointe pas vers une seule copie.

**Sondes readiness/liveness et limite de `/health` :**

Les deux probes du Deployment ciblent `/health` sur le port `3000` :

```text
Liveness:  http-get http://:http/health delay=20s timeout=2s period=10s
Readiness: http-get http://:http/health delay=5s timeout=2s period=5s
```

Test realise en coupant volontairement PostgreSQL :

```sh
kubectl scale deployment/todo-db -n todo --replicas=0
```

Resultat observe pendant que la base etait a `0` replica :

| Verification | Resultat |
|---|---|
| `kubectl get pods -n todo -l app=todo-api` | 3 pods `READY 1/1`, `Running` |
| `GET /health` via Ingress | `200` |
| `GET /api/tasks` via Ingress | `500` |

Conclusion : les sondes prouvent que le serveur HTTP repond, pas que la base
PostgreSQL rend le service attendu. La base a ensuite ete remise a un replica
avec `kubectl scale deployment/todo-db -n todo --replicas=1`, puis
`GET /api/tasks` est revenu a `200`.

**Rolling update sous charge :**

Reglage actif dans le Deployment : `replicas: 3`, `maxSurge: 1`,
`maxUnavailable: 0`.

Pendant une charge continue sur `GET /api/tasks` via l'Ingress, l'image du
Deployment est passee de `nutsugan/todo-api:7f31beabe82e` a
`nutsugan/todo-api:phase8-898e761` :

```sh
kubectl set image deployment/todo-api todo-api=nutsugan/todo-api:phase8-898e761 -n todo
kubectl rollout status deployment/todo-api -n todo --timeout=180s
```

Resultat mesure :

```text
deployment "todo-api" successfully rolled out
ROLLOUT_SECONDS=25
Total : 71 requetes, 0 echouees (code != 200)
```

Apres convergence, le Deployment indiquait 3 replicas updated, ready et
available, et `kubectl rollout history deployment/todo-api -n todo` listait les
revisions 1 et 2.

**Retour arriere Kubernetes :**
- SHA deploye avant regression : `phase8-898e761`.
- Regression testee : `PGHOST=todo-db-broken` injecte dans le template du
  Deployment avec `kubectl set env`.
- Signature : nouveaux pods en `CrashLoopBackOff`, rollout non convergent, les
  anciens pods continuent de servir grace a `maxUnavailable: 0`.
- Commande de retour arriere : `kubectl rollout undo deployment/todo-api -n todo`.
- Revision Kubernetes de retour : revision `4`, issue de la revision saine
  precedente.
- Temps entre constat et retablissement : `8,8 s`.
- Verifications apres rollback : `/health` et `/api/tasks` repondent `200`, 3
  replicas API sont `READY 1/1`.

Une regression a ete declenchee avec :

```sh
kubectl set env deployment/todo-api PGHOST=todo-db-broken -n todo
kubectl rollout status deployment/todo-api -n todo --timeout=180s
```

Le rollout n'a pas converge : deux nouveaux pods sont passes en
`CrashLoopBackOff`, pendant que les anciens pods continuaient de servir le
trafic. Le retour arriere a ensuite ete lance :

```sh
kubectl rollout undo deployment/todo-api -n todo
kubectl rollout status deployment/todo-api -n todo --timeout=180s
```

Resultat mesure :

```text
deployment "todo-api" successfully rolled out
ROLLBACK_SECONDS=8.8
AFTER_ROLLBACK_HEALTH_STATUS=200
AFTER_ROLLBACK_TASKS_STATUS=200
```

Historique apres l'exercice :

```text
REVISION  CHANGE-CAUSE
1         <none>
3         phase9 broken PGHOST
4         phase9 rollback to healthy revision
```

**Ressources testees :**

| `limits.memory` | Charge lancee | Resultat | Observation |
|---:|---|---|---|
| 128Mi | Repos | OK | Valeur initiale du manifest, `kubectl top` autour de `24Mi` avant serrage |
| 32Mi | 77 requetes sur `GET /api/tasks` | 0 echec | Stable, memoire autour de `17Mi` |
| 24Mi | 74 requetes sur `GET /api/tasks` | 0 echec | Stable, memoire autour de `16-17Mi` |
| 20Mi | 79 requetes sur `GET /api/tasks` | 0 echec | Stable, memoire autour de `17Mi` |
| 18Mi | 78 requetes sur `GET /api/tasks` | 0 echec, puis redemarrages observes pendant l'essai suivant | Trop serre pour etre retenu |
| 16Mi | Rollout | Echec | Pods en `CrashLoopBackOff`, probes qui echouent |

Valeur retenue dans `k8s/todo-api-deployment.yaml` : `requests.memory: 16Mi`
et `limits.memory: 20Mi`.

Validation finale sous charge pendant un rolling restart avec cette valeur :

```text
deployment "todo-api" successfully rolled out
FINAL_20MI_ROLLOUT_SECONDS=22.8
FINAL_20MI_TOTAL=91
FINAL_20MI_FAILED=0
```

Releve final :

```text
NAME                        CPU(cores)   MEMORY(bytes)
todo-api-8489975579-46mgv   16m          15Mi
todo-api-8489975579-4g2p6   11m          16Mi
todo-api-8489975579-5kh8w   14m          17Mi
```

**Diagnostic chaos :**

| Panne | Signature pods | Signature events | Se repare seule ? | Remede |
|---|---|---|---|---|
| Pod supprime | Un pod disparait, un nouveau pod du meme ReplicaSet apparait en moins d'une minute | `SuccessfulCreate` sur le ReplicaSet, ancien pod en suppression | Oui | Attendre le nouveau pod, puis verifier `kubectl get pods -n todo -l app=todo-api` |
| Processus tue | Sur ce cluster Docker Desktop, `kill 1`, `kill -9 1` et `killall -9 node` depuis `kubectl exec` ont retourne `0` mais `RESTARTS` est reste a `0` | Aucun `Last State: Terminated` observe ; a retester sur k3d/K3s si `chaos.sh` tire ce cas | Oui si le process meurt vraiment | Attendre le redemarrage ; si le runtime ne reproduit pas la panne, supprimer le pod pour recuperer une copie saine |
| Tag d'image inexistant | Anciennes copies toujours `Running`, un nouveau pod en `ErrImagePull` puis `ImagePullBackOff` | `Failed to pull image`, `insufficient_scope`, `Back-off pulling image` | Non | `kubectl rollout undo deployment/todo-api -n todo` |
| Cle du Secret supprimee | `PGPASSWORD` absent du Secret, rollout restart non convergent dans le delai ; les anciennes copies peuvent continuer de servir | Le cluster ne recrée pas la cle manquante ; la correction doit venir du Secret | Non | Restaurer `todo-secret`, puis `kubectl rollout restart deployment/todo-api -n todo` |
| Limite memoire trop basse | Nouveau pod en `CrashLoopBackOff`, anciennes copies gardees par `maxUnavailable: 0` | `container init was OOM-killed (memory limit too low?)`, puis `Back-off restarting failed container` | Non | `kubectl rollout undo deployment/todo-api -n todo` ou remonter `resources.limits.memory` |

### Pipeline, tests d'integration et monitoring (2026-08-05)

La pipeline a ete deplacee sur le vrai projet Todo API. Le workflow
`.github/workflows/ci-cd.yml` lance les tests avec une vraie base PostgreSQL
jetable, construit les images `todo-api` et `stats-api`, les tague au SHA du
commit, puis deploie depuis `main` sur un runner self-hosted par SSH.
Si les secrets Docker Hub ne sont pas encore configures, le workflow construit
les images sans les publier et saute le deploiement.

**Tests ajoutes :**
- creation d'une tache puis relecture par identifiant ;
- demande d'une tache inexistante avec retour `404` ;
- corps invalide avec retour `400` ;
- suppression puis verification que la tache a disparu de la liste ;
- exposition et evolution des metriques Prometheus.

**Instrumentation :**
- route `/metrics` en texte brut Prometheus ;
- compteur `http_requests_total` par methode, route normalisee et statut ;
- histogramme `http_request_duration_seconds` pour calculer le p95 ;
- metriques metier `tasks_created_total` et `tasks_in_database`.

**Fichiers de production ajoutes :**
- `deploy/compose.yml` pour `todo-api`, `stats-api`, `todo-db`, `prometheus`
  et `grafana` ;
- `deploy/prometheus.yml` avec scrape de `todo-api:3000` ;
- `deploy/alerts.yml` avec alertes API down, 5xx eleves et p95 eleve ;
- `.gitlab-ci.yml` comme carte de traduction GitLab-CI equivalente ;
- `.github/workflows/rollback.yml` pour declencher un retour arriere depuis
  GitHub Actions avec un SHA choisi ;
- provisioning Grafana et dashboard `Todo API - Golden Signals` ;
- `Dockerfile.vm` pour documenter une machine cible Linux avec SSH et Docker ;
- `docs/PROCEDURE_DEPLOIEMENT.md` pour le deploiement, les verifications,
  le rollback et les signatures de panne.
- `docs/CONFIGURATION_GITHUB_ACTIONS.md` pour brancher Docker Hub, les secrets
  et le runner self-hosted.
- `scripts/incident.sh` pour tirer une panne aleatoire pendant la passation.

**Releves Grafana a completer pendant l'exercice :**

| Moment | up | Requetes/s | Taux d'erreur | p95 |
|---|---:|---:|---:|---:|
| Au repos, avant la boucle de charge | A mesurer | A mesurer | A mesurer | A mesurer |
| Pendant la boucle de charge | A mesurer | A mesurer | A mesurer | A mesurer |
| Pendant l'incident | A mesurer | A mesurer | A mesurer | A mesurer |

**Retour arriere chronometre :**
- SHA deploye avant regression : a renseigner.
- SHA de retour arriere : a renseigner.
- Temps entre constat et retablissement : a mesurer.

**Passation d'astreinte :**
- Role pilote : a completer apres passage.
- Role mains : a completer apres passage.
- Ligne de procedure manquante ou ambigue : a completer apres passage.

### Dockerfile de production (2026-08-03)

Passage du Dockerfile de dev à un Dockerfile de prod, multi-stage.

**Vérifications :**
- Image de base épinglée : `node:22.14.0-alpine` (pas de `latest`).
- `.dockerignore` complet : `docker run --rm monimage ls -a` ne montre ni `.git`, ni `.env`, ni logs. Contexte transféré : quelques Ko (`transferring context: 107B` / `2.16kB`).
- Process non-root : `docker run --rm monimage sh -c whoami` → `node`.
- Multi-stage, deps de dev absentes du runtime : `docker run --rm monimage ls node_modules | grep -c jest` → `0` (aucun outil de test dans `package.json` actuellement).
- Ordre des instructions protège le cache : modification du code applicatif seul (pas `package.json`) puis rebuild → les deux étapes `npm install` restent `CACHED`.

**Mesures :**
- Taille de l'image : `160MB`.
- Build à froid (`--no-cache`) : `1.167s` total.
- Build à chaud (cache plein) : `0.468s` total, 5 layers `CACHED`.

### Persistance PostgreSQL (2026-08-03)

Les tâches vivaient en mémoire (perdues à chaque redémarrage du conteneur API).
Ajout d'un conteneur Postgres à part, lancé à la main avec `docker run`, volume
nommé pour les données. Pas de network custom : le conteneur atterrit sur le
bridge par défaut, donc l'API le joint par IP interne, pas par nom.

**Commande utilisée :**
```
docker run -d --name todo-postgres \
  -e POSTGRES_DB=todo \
  -e POSTGRES_USER=todo \
  -e POSTGRES_PASSWORD=todo_pw \
  -v todo-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

**IP interne trouvée** (via `docker network inspect bridge`) : `192.168.215.3`,
renseignée dans `.env` (`PGHOST`).

**Vérifications :**
- Tâche créée via l'API toujours présente après `docker stop` puis `docker start`
  du conteneur Postgres.
- Tâche toujours présente après `docker rm` du conteneur suivi d'un nouveau
  `docker run` pointant sur le même volume nommé `todo-postgres-data` (l'IP
  interne récupérée était identique, mais ce n'est pas garanti en général).

Cinq options à la main sur une seule ligne de commande (image, 3 variables
d'env, volume) rien que pour Postgres, plus la manip pour retrouver l'IP à
chaque recréation : ça fait beaucoup d'étapes manuelles et fragiles comparé à
ce qu'on imagine possible avec un seul fichier déclaratif.

### Network custom (2026-08-03)

L'IP interne trouvée à l'étape précédente est fragile (change si le conteneur
est recréé) et rien n'empêchait de publier le port Postgres vers l'hôte par
erreur. Correction : un network Docker créé explicitement, API et base dessus,
connexion par nom de conteneur.

**Commande utilisée :**
```
docker network create todo-network
```

Nom retenu : `todo-network`.

Postgres relancé sur ce network, toujours sans `-p` (le port 5432 n'a jamais
été publié vers l'hôte, y compris avant cette étape) :
```
docker run -d --name todo-postgres \
  --network todo-network \
  -e POSTGRES_DB=todo \
  -e POSTGRES_USER=todo \
  -e POSTGRES_PASSWORD=todo_pw \
  -v todo-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

`.env` : `PGHOST` passe de l'IP interne à `todo-postgres` (le nom du
conteneur, résolu via le DNS interne du network custom).

**Vérifications :**
- Toutes les routes CRUD répondent normalement via l'API connectée par nom
  de conteneur (`GET`/`POST /api/tasks` testés).
- Tentative de connexion à Postgres depuis l'hôte : `nc -zv localhost 5432`
  a d'abord semblé réussir alors qu'aucun `-p` n'est présent sur la commande
  Postgres. En cause : OrbStack expose automatiquement les ports des
  conteneurs sur l'hôte, indépendamment de `-p` — un comportement propre à
  OrbStack, pas au moteur Docker standard. Avec Docker Desktop/Engine
  classique, `nc -zv localhost 5432` renverrait `Connection refused` : sans
  `-p`, le port n'existe simplement pas côté hôte. Sur cet environnement,
  c'est donc l'absence de `-p` dans la commande `docker run` (vérifiable
  avec `docker port todo-postgres`, qui ne retourne rien) qui fait foi, pas
  le résultat de `nc`.

### Docker Compose (2026-08-03)

Remplacement des étapes manuelles (`docker network create`, `docker volume
create`, deux `docker run` à rallonge) par un seul `docker-compose.yml` :
services `api` (`build: .`) et `postgres` (`image: postgres:16-alpine`),
volume nommé, healthcheck Postgres (`pg_isready`) couplé à
`depends_on: condition: service_healthy` côté `api` pour éviter de démarrer
avant que la base accepte des connexions. Volume existant `todo-postgres-data`
réutilisé via `external: true` pour ne pas perdre les données déjà écrites.

En creusant la config, deux problèmes trouvés et corrigés au passage :
- `.env` était suivi par git (pas dans `.gitignore`) et déjà commité avec un
  mot de passe en clair. Ajouté à `.gitignore`, retiré du suivi
  (`git rm --cached`). Le mot de passe reste dans l'historique git tant
  qu'aucun rewrite d'historique n'est fait — hors scope ici.
- `docker-compose.yml` avait initialement `PGPASSWORD`/`POSTGRES_PASSWORD`
  écrits en dur dans `environment:`. Déplacés dans `.env`, référencé via
  `env_file:` sur les deux services. Le reste (host, port, user, nom de
  base) reste en `environment:` : rien de sensible, autant que ce soit
  visible directement dans le fichier commité.

Port hôte de l'API : `3001` (et non `3000`) dans cet environnement, un
conteneur préexistant sans rapport occupe déjà `3000` sur la machine.

**Commandes du quotidien :** `docker compose up -d --build`, `docker compose
ps`, `docker compose logs -f`, `docker compose down` (garde le volume).

### Second service : stats-api en Python (2026-08-03)

Ajout de `stats-api`, un service FastAPI (fourni complet, rien à écrire côté
Python) qui lit la même base Postgres que `api` et expose le nombre de
tâches par statut. Deux adaptations nécessaires au code donné pour qu'il
corresponde au schéma réel du chapitre 6 :
- `KNOWN_STATUSES` changé de `["todo", "in_progress", "done"]` à
  `["pending"]` : le modèle `tasks` actuel n'a pas de workflow de
  transition d'état, `status` vaut toujours `'pending'` par défaut.
- Noms de variables d'environnement (`DB_HOST`, `DB_PORT`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD`) différents de ceux utilisés côté Node
  (`PGHOST`, etc.) : mêmes valeurs, deux jeux de clés, câblés tous les
  deux dans `docker-compose.yml`/`.env` plutôt que d'harmoniser les noms
  entre les deux services.

`stats-api` rejoint le même network Compose que `api` et `postgres` (network
par défaut du fichier, pas besoin de le nommer explicitement), avec le même
`depends_on: condition: service_healthy` sur Postgres. Port hôte : `8000`.

**Vérifications :**
- `curl http://localhost:8000/health` → `{"status":"ok"}`
- `curl http://localhost:8000/stats` → `{"pending":3}` (3 tâches créées
  pendant les tests précédents, toutes en `pending`)
- `docker network inspect docker-project_default` liste bien les trois
  conteneurs (`api`, `postgres`, `stats-api`) sur le même network.

### Registry et déploiement depuis les images publiées (2026-08-03)

`todo-api` et `stats-api` poussés sur Docker Hub (`gabrielmartin13/todo-api`,
`gabrielmartin13/stats-api`), tag `1.0.0` explicite plutôt que `latest`.

```
docker login -u gabrielmartin13
docker tag docker-project-api:latest gabrielmartin13/todo-api:1.0.0
docker tag docker-project-stats-api:latest gabrielmartin13/stats-api:1.0.0
docker push gabrielmartin13/todo-api:1.0.0
docker push gabrielmartin13/stats-api:1.0.0
```

`docker-compose.prod.yml` reprend le fichier compose d'origine avec chaque
`build:` remplacé par `image: gabrielmartin13/<service>:<version>`, et le
volume Postgres en volume Compose normal (plus d'`external: true`) : le
critère de réussite explicite était un dossier neuf, sans le volume
préexistant du poste de dev, donc `external: true` aurait cassé le scénario
nominal ailleurs que sur cette machine.

**Vérification nominale :** dossier neuf avec uniquement
`docker-compose.prod.yml` et un `.env` recopié depuis `.env.example`,
`docker compose -f docker-compose.prod.yml up -d` démarre les trois
conteneurs sans qu'aucun fichier source ne soit présent (confirmé par
`find` sur le dossier : deux fichiers, le compose et le `.env`).

**Vérification adverse (`docker history`) :** aucune trace de
`PGPASSWORD`, `DB_PASSWORD` ni de `.env` dans l'historique des deux images
publiées. Les secrets ne passent jamais par `ARG`/`ENV` dans les
Dockerfiles, uniquement par `environment:`/`env_file:` au runtime — rien à
lier à l'image elle-même.

#### Tableau de mesures

| Image | Taille | Couches (poids max) | Build froid / chaud | 1re réponse HTTP |
|---|---|---|---|---|
| todo-api | 159MB | 142MB (base node:alpine), 8.17MB, 5.37MB | 1.995s / 0.471s | 21ms |
| stats-api | 167MB | 100MB (base python:slim), 40MB (pip install), 23MB | 2.897s / 0.435s | 213ms |

Mesures prises sans `docker system prune` préalable (juste `--no-cache` pour
le build froid) : le cache des images de base `node:22-alpine` et
`python:3.12-slim`, déjà locales, reste chaud. L'écart froid/chaud reste
donc une borne basse de ce qu'un vrai environnement CI verrait avec un cache
totalement vide.

stats-api répond 10x plus lentement à sa première requête que todo-api
(213ms contre 21ms) alors que son image n'est pas franchement plus lourde :
l'écart vient du démarrage d'Uvicorn + import de FastAPI/psycopg2 côté
Python, plus lourd au boot qu'Express côté Node, pas de la taille de
l'image. C'est exactement le point que la métrique "temps de 1re réponse"
est censée révéler et que la taille seule ne montre pas.

Aucune optimisation supplémentaire tentée pour l'instant : `todo-api` est
déjà sous la cible des 150 Mo (159MB, proche) et `stats-api` sous les 180 Mo
(167MB). Pas de régression à consigner à ce stade.

#### Test bout en bout depuis les images publiées

Stack relancée dans un dossier neuf, scénario complet :
1. **POST avec champ obligatoire manquant** (`{}` sans `description`) →
   `400 { "error": "description is required" }`, rejeté proprement, pas de
   crash.
2. **`localhost:5432` depuis l'hôte** → `docker port` sur le conteneur
   Postgres ne retourne rien (aucun port publié), cohérent avec le chapitre
   6. `nc`/`psql` peuvent sembler aboutir sur cette machine à cause du
   comportement d'exposition automatique d'OrbStack déjà noté plus haut ;
   `docker port` reste la source de vérité.
3. **`/stats` vs `COUNT` manuel** → `{"pending":2}` côté API,
   `SELECT status, COUNT(*) FROM tasks GROUP BY status` côté `psql` donne
   exactement `pending | 2`. Cohérent.
4. **`docker kill` sur le conteneur Postgres en pleine charge** → les deux
   services réagissent différemment :
   - `stats-api` dégrade proprement : `/stats` → `503` avec un message
     explicite (`stats-api ne parvient pas à joindre la base de données`),
     `/health` reste `200` (volontairement indépendant de Postgres dans le
     code fourni).
   - `todo-api` **plantait entièrement** (conteneur `Exited (1)`, même
     `/health` devenait injoignable) : le pool `pg` remonte une erreur de
     connexion en tant qu'événement `error` non écouté sur le client idle,
     ce qui fait planter tout le process Node plutôt que de la faire
     remonter proprement dans une requête en cours.

**Correctif appliqué** (`src/db.js`) : ajout d'un handler
`pool.on('error', ...)` qui logue l'erreur au lieu de laisser Node planter
sur un événement non géré. Image republiée en `gabrielmartin13/todo-api:1.0.1`
(nouveau tag, pas d'écrasement silencieux du `1.0.0` déjà poussé). Retest :
le conteneur reste `Up`, `/api/tasks` répond `500 Internal server error`
proprement au lieu de devenir injoignable.
