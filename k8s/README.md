# Kubernetes deployment

These manifests run the Todo API in the `todo` namespace on the local
`todo-cluster` Kubernetes cluster.

Initial setup:

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

The committed Secret uses exercise placeholders. Replace it in the cluster with
the real runtime values if needed, and do not commit real credentials.

Checks:

```sh
kubectl get pods -n todo
kubectl get pvc -n todo
curl -s -H "Host: todo.localhost" http://localhost:8080/health
```

The GitHub Actions deploy job updates only the API image and applies non-secret
manifests. It expects `todo-secret` to already exist in the cluster.

## Docker Desktop fallback

Docker Desktop can create a local `kind` cluster when `k3d` is unavailable. In
that mode, no Traefik controller is installed by default, so apply the optional
development controller before testing the Ingress:

```sh
kubectl apply -f k8s/traefik-dev.yaml
kubectl rollout status deployment/traefik-dev -n kube-system --timeout=120s
curl -s -H "Host: todo.localhost" http://localhost:8080/health
```

This file is for the local Docker Desktop cluster only. It is intentionally not
used by the GitHub Actions deploy job.
