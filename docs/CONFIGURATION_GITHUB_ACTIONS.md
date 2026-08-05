# Configuration GitHub Actions

Ce document explique comment passer d'une CI verte sans deploiement a un
deploiement reel sur une machine cible.

## 1. Docker Hub

Creer un token Docker Hub, puis ajouter ces secrets dans
`Settings > Secrets and variables > Actions > Repository secrets` :

- `DOCKERHUB_USERNAME` : namespace Docker Hub qui recevra les images.
- `DOCKERHUB_TOKEN` : token Docker Hub avec droit de push.

Si le namespace d'image n'est pas le meme que le username, ajouter aussi dans
`Settings > Secrets and variables > Actions > Variables` :

- `DOCKER_IMAGE_NAMESPACE`

Verification attendue apres push sur `main` :

- le job `Build Docker images` se connecte a Docker Hub ;
- les images suivantes existent :
  - `<namespace>/todo-api:<sha>`
  - `<namespace>/stats-api:<sha>`

## 2. Machine cible

La machine cible doit avoir :

- Docker ;
- Docker Compose v2 ;
- SSH actif ;
- un compte de service `deploy` pouvant executer `docker compose`.

Dossier attendu :

```sh
sudo mkdir -p /srv/todo
sudo chown deploy:deploy /srv/todo
```

Fichier `/srv/todo/.env` a creer manuellement :

```env
PGPASSWORD=<mot-de-passe-postgres>
POSTGRES_PASSWORD=<mot-de-passe-postgres>
DB_PASSWORD=<mot-de-passe-postgres>
```

Ne jamais commiter ce fichier.

## 3. Cle SSH de deploiement

Generer une cle dediee au deploiement :

```sh
ssh-keygen -t ed25519 -C "deploy@todo-api-pipeline" -f ./deploy_key
```

Installer la cle publique sur la machine cible :

```sh
ssh-copy-id -i ./deploy_key.pub deploy@<DEPLOY_HOST>
```

Ajouter la cle privee comme secret GitHub :

- `DEPLOY_SSH_KEY` : contenu complet du fichier `deploy_key`.

La cle privee ne doit jamais etre ajoutee au depot.

## 4. Secrets de deploiement

Ajouter ces secrets GitHub :

- `DEPLOY_HOST` : IP ou nom DNS de la machine cible.
- `DEPLOY_PORT` : port SSH, souvent `22`.
- `DEPLOY_USER` : utilisateur SSH, normalement `deploy`.

Verification locale depuis ton poste :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> 'docker version && docker compose version'
```

## 5. Runner self-hosted

Le job `Deploy production` utilise `runs-on: self-hosted`. Il faut donc un
runner GitHub Actions joignable depuis la machine cible ou installe sur le meme
reseau.

Dans GitHub :

1. Ouvrir `Settings > Actions > Runners`.
2. Cliquer sur `New self-hosted runner`.
3. Suivre les commandes donnees par GitHub pour installer et lancer le runner.

Verification attendue :

- le runner apparait `Idle` dans GitHub ;
- apres un push sur `main`, le job `Deploy production` n'est plus bloque en
  attente de runner.

## 6. Premier deploiement reel

1. Pousser un commit sur `main`.
2. Attendre les jobs `Unit and integration tests` et `Build Docker images`.
3. Attendre `Deploy production`.
4. Verifier l'API :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> 'curl -fsS http://localhost:3000/health'
```

5. Verifier Prometheus :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'curl -fsS "http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22todo-api%22%7D"'
```

6. Verifier Grafana sur `http://localhost:3001`.

## 7. Commandes de controle

Voir les conteneurs :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'
```

Voir les logs de l'API :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'docker logs todo-api --tail=120'
```

Verifier l'image deployee :

```sh
ssh -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  'docker inspect -f "{{.Config.Image}}" todo-api'
```
