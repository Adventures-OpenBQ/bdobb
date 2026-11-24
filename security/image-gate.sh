#!/usr/bin/env bash
# Build locally, inspect the exact saved image (all layers + configuration),
# then push that same local image. No registry/cache writes precede the gate.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -ne 5 ]; then
  echo 'usage: bash security/image-gate.sh CONTEXT DOCKERFILE PLATFORM IMAGE REVISION' >&2
  exit 2
fi
context="$1"; dockerfile="$2"; platform="$3"; image="$4"; revision="$5"
python3 "$root/security/gate.py" --repo "$PWD" --exceptions "$root/security/privacy-exceptions.json" --fixture-exceptions "$root/security/reviewed-fixtures.json" tree
scratch="$(mktemp -d)"
# A Dockerfile-specific ignore file overrides a context's .dockerignore. Merge
# existing exclusions with the current secret policy, including historical tags.
specific="${dockerfile}.dockerignore"
had_specific=0
if [ -f "$specific" ]; then
  cp "$specific" "$scratch/original.dockerignore"
  had_specific=1
fi
cleanup() {
  if [ "$had_specific" = 1 ]; then cp "$scratch/original.dockerignore" "$specific"; else rm -f "$specific"; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
if [ "$had_specific" = 1 ]; then
  cat "$scratch/original.dockerignore" > "$specific"
elif [ -f "$context/.dockerignore" ]; then
  cp "$context/.dockerignore" "$specific"
else
  : > "$specific"
fi
printf '\n' >> "$specific"
cat "$root/security/dockerignore" >> "$specific"
# No cache export: an unsafe layer must never reach a remote cache either.
build=(docker buildx build --load --platform "$platform" --file "$dockerfile"
  --tag "$image" --metadata-file "$scratch/build.json"
  --label "org.opencontainers.image.version=${IMAGE_VERSION:-}"
  --label "org.opencontainers.image.revision=$revision"
  --label "org.opencontainers.image.source=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-local}")
if [ -n "${BUILD_TARGET:-}" ]; then build+=(--target "$BUILD_TARGET"); fi
"${build[@]}" "$context"
# Address the immutable local image ID after the build, not a mutable tag.
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
docker save --output "$scratch/image.tar" "$image_id"
python3 "$root/security/gate.py" --repo "$PWD" --exceptions "$root/security/privacy-exceptions.json" --fixture-exceptions "$root/security/reviewed-fixtures.json" image-archive "$scratch/image.tar"
# Re-tag the scanned ID immediately before pushing, never rebuild after scan.
docker tag "$image_id" "$image"
docker push "$image"
