#!/bin/sh
set -eu

cd "$(dirname "$0")"

BUILDER=slot-machine-multiarch
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi
docker buildx inspect --bootstrap "$BUILDER"

docker buildx build \
  --builder "$BUILDER" \
  --platform linux/amd64,linux/arm64 \
  --file Dockerfile.backend \
  --tag kryptikker/slot-machine-backend:latest \
  --push \
  .

docker buildx build \
  --builder "$BUILDER" \
  --platform linux/amd64,linux/arm64 \
  --file frontend/Dockerfile \
  --tag kryptikker/slot-machine-frontend:latest \
  --push \
  frontend
