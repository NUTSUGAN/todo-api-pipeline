#!/bin/sh
set -eu

# Run this on the target machine during the handoff exercise.
# It intentionally breaks one production component; do not run it locally.

N=$(( $(od -An -N1 -tu1 /dev/urandom) % 5 + 1 ))
echo "$N" | base64 > /root/.incident

IMAGE=$(docker inspect -f '{{.Config.Image}}' todo-api)

case "$N" in
  1)
    docker stop todo-api
    ;;
  2)
    docker stop todo-db
    ;;
  3)
    NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' todo-api | awk '{print $1}')
    docker network disconnect "$NET" todo-api
    ;;
  4)
    docker rm -f todo-api
    docker run -d --name todo-api -p 3000:3000 "$IMAGE"
    ;;
  5)
    for i in 1 2 3 4; do
      docker run -d --name "hog-$i" alpine:3.20 sh -c 'while :; do :; done'
    done
    ;;
esac
