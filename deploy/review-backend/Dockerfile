# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# OpenBB's own reference backend, containerised.
#
# Upstream ships no Dockerfile for it, so this one clones the repo (bdobb-dev's
# fork of the archived upstream, as scripts/reference-backend.sh does) at a pinned
# commit -- the SAME commit scripts/reference-backend.sh and the CI
# `reference` job pin (REF_BACKEND_REF), so the funnelled build and the
# conformance suite are testing the same corpus.
#
# This image holds no credentials and reads no provider: the reference backend
# serves synthetic sample data and nothing else. That is what makes it safe to
# publish.
# Pinned by digest (python:3.12-slim as of 2026-10-03) so a rebuild cannot
# silently pick up a different base; bump the digest deliberately.
FROM python:3.12-slim@sha256:dddfd7e07f9d15aeeca61529320492139d21cac7f0070c00609243e51e4e0016

ARG REF=32615f789f9423ea14d3f95003da250f4ef5bcfc

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --quiet https://github.com/bdobb-dev/backends-for-openbb . \
 && git checkout --quiet "${REF}"

WORKDIR /src/getting-started/reference-backend
RUN pip install --no-cache-dir -r requirements.txt

# Not root: the app only reads its own files and serves HTTP.
RUN useradd --create-home --uid 10001 app
USER app

# Binds every interface IN THIS CONTAINER, which on a private bridge with no
# published ports means the bridge only -- Caddy is the sole thing that can
# reach it, and Serve is the sole thing that can reach Caddy.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5050"]
