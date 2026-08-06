# Procedure de deploiement Todo API

Cette procedure sert a deployer, diagnostiquer et retablir la Todo API dans le
cluster Kubernetes local `todo-cluster`.

## 1. Cible de production

- Depot GitHub : `https://github.com/NUTSUGAN/todo-api-pipeline`
- Cluster attendu : `todo-cluster`
- Namespace : `todo`
- API depuis le poste : `http://todo.localhost:8080`
- Image API : `nutsugan/todo-api:<sha>`
- Manifests Kubernetes : `k8s/`

Acces requis sur le runner self-hosted :

- `kubectl` installe sur le PATH ;
- kubeconfig qui pointe vers `todo-cluster` ;
- contexte actif verifiable avec `kubectl config current-context` ;
- Secret runtime `todo-secret` deja present dans le namespace `todo`.

Le fichier kubeconfig, un `.env` et de vrais mots de passe ne doivent jamais
etre commit.

## 2. Premier demarrage du cluster

```sh
docker stop vm-prod
k3d cluster create todo-cluster -p "8080:80@loadbalancer"
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/todo-secret.yaml
kubectl apply -f k8s/todo-config.yaml
kubectl apply -f k8s/todo-db.yaml
kubectl apply -f k8s/todo-api-deployment.yaml
kubectl apply -f k8s/todo-api-service.yaml
kubectl apply -f k8s/todo-ingress.yaml
kubectl rollout status deployment/todo-api -n todo --timeout=120s
```

Verifications :

```sh
kubectl get pods -n todo
kubectl get pvc -n todo
curl -fsS -H "Host: todo.localhost" http://localhost:8080/health
```

Resultat attendu : les pods `todo-api` sont `Running` et `READY 1/1`, la PVC
`todo-db-data` est `Bound`, et `/health` repond `{"status":"ok",...}`.

## 3. Deploiement normal par la pipeline

1. Pousser un commit sur `main`.

   Verification : le workflow `CI/CD` demarre dans GitHub Actions.

2. Attendre le job `Unit and integration tests`.

   Verification : `npm test` passe avec PostgreSQL lance en service.

3. Attendre le job `Build Docker images`.

   Verification : l'image `todo-api:<sha>` est construite et poussee sur
   Docker Hub.

4. Attendre le job `Deploy Kubernetes`.

   Verification : le job tourne sur le runner `self-hosted`, applique les
   manifests non sensibles, met a jour l'image du Deployment, puis attend :

   ```sh
   kubectl rollout status deployment/todo-api -n todo --timeout=180s
   ```

5. Verifier l'API :

   ```sh
   curl -fsS -H "Host: todo.localhost" http://localhost:8080/health
   curl -fsS -H "Host: todo.localhost" http://localhost:8080/api/tasks
   ```

Si le rollout ne converge pas, le job doit echouer. Ne pas declarer un
deploiement reussi tant que `rollout status` n'est pas vert.

## 4. Deploiement manuel d'urgence

Utiliser cette sequence seulement si la pipeline est en panne.

```sh
kubectl config current-context
kubectl get nodes
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/todo-config.yaml
kubectl apply -f k8s/todo-db.yaml
kubectl apply -f k8s/todo-api-deployment.yaml
kubectl apply -f k8s/todo-api-service.yaml
kubectl apply -f k8s/todo-ingress.yaml
kubectl set image deployment/todo-api todo-api=nutsugan/todo-api:<sha> -n todo
kubectl rollout status deployment/todo-api -n todo --timeout=180s
```

Point de controle final :

```sh
kubectl describe deployment todo-api -n todo | grep Image
curl -fsS -H "Host: todo.localhost" http://localhost:8080/health
```

## 5. Retour arriere

Declencher un retour arriere si une regression est constatee sur `/health`,
`/api/tasks`, le taux de `5xx`, ou pendant un rolling update sous charge.

```sh
kubectl rollout history deployment/todo-api -n todo
kubectl rollout undo deployment/todo-api -n todo
kubectl rollout status deployment/todo-api -n todo --timeout=180s
```

Pour revenir a une revision precise :

```sh
kubectl rollout undo deployment/todo-api -n todo --to-revision=<revision>
kubectl rollout status deployment/todo-api -n todo --timeout=180s
```

Le chronometre demarre au moment ou la regression est constatee et s'arrete
quand `/health` repond de nouveau normalement.

## 6. Limite connue des sondes

Les probes `readinessProbe` et `livenessProbe` appellent `/health`. Cette route
verifie que le serveur HTTP repond, pas que PostgreSQL repond. Si la base est
coupee, le pod peut rester `READY 1/1` alors que `/api/tasks` renvoie une
erreur `500`.

Diagnostic a faire dans ce cas :

```sh
kubectl get pods -n todo
kubectl logs -n todo deployment/todo-api --tail=120
curl -i -H "Host: todo.localhost" http://localhost:8080/api/tasks
```

## 7. Pannes connues et signatures

| Panne | Signature dans `kubectl get pods` | Signature describe/events | Se repare seule ? | Remede |
|---|---|---|---|---|
| Pod supprime | Un nouveau pod apparait, l'ancien passe en `Terminating` | Event de suppression puis creation par ReplicaSet | Oui | Attendre puis verifier `kubectl get pods -n todo` |
| Processus tue dans le conteneur | `RESTARTS` augmente, puis pod redevient `Running` | `Last State: Terminated`, redemarrage par kubelet | Oui | Attendre puis verifier `/health` |
| Tag d'image inexistant | `ImagePullBackOff` ou `ErrImagePull` | Events `Failed to pull image` | Non | `kubectl rollout undo deployment/todo-api -n todo` |
| Cle du Secret supprimee | Pod en `CreateContainerConfigError` ou app en erreur selon le moment | Secret key missing ou variable absente | Non | Reappliquer le secret correct, puis `kubectl rollout restart deployment/todo-api -n todo` |
| Limite memoire trop basse | `CrashLoopBackOff`, `RESTARTS` augmente | `Last State: Terminated`, `Reason: OOMKilled` | Non | Retirer ou augmenter `resources.limits.memory`, puis attendre le rollout |

Pour reveler le numero de panne apres diagnostic :

```sh
base64 -d .incident
```

## 8. Commandes utiles

```sh
kubectl get all -n todo
kubectl describe pod -n todo <pod>
kubectl logs -n todo deployment/todo-api --tail=120
kubectl get endpoints -n todo todo-api
kubectl get ingress -n todo
kubectl top pods -n todo
```

Generer de la charge :

```sh
sh scripts/charge.sh 30
```
