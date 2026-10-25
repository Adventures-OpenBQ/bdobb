# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# OpenBB's backends-for-openbb reference app (bdobb-dev's fork of the archived
# repo, as scripts/reference-backend.sh clones), packaged for the public demo:
# plain uvicorn plus `websockets` (the reference ships uvicorn without WS, and
# live_grid needs it), and a CORS list driven by EXTRA_CORS_ORIGINS so the same
# image serves localhost, pro.openbb.co and the deployed demo frontend.
# The Python Chart omni widget (exec on the request body) is removed for the
# public image; scripts/reference-backend.sh keeps it for local development.
# Pinned by digest (python:3.12-slim as of 2026-10-03) so a rebuild cannot
# silently pick up a different base; bump the digest deliberately.
FROM python:3.12-slim@sha256:dddfd7e07f9d15aeeca61529320492139d21cac7f0070c00609243e51e4e0016

# Pin the upstream commit for reproducible rebuilds; override at build time.
# The default is the SAME commit .github/workflows/ci.yml pins as REF_BACKEND_REF
# (web/refdemo-pin.test.mjs keeps the two equal). A branch or tag also works.
ARG REF_BACKEND_REF=32615f789f9423ea14d3f95003da250f4ef5bcfc

RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# `git clone --branch` rejects a commit SHA, so init + fetch the ref (GitHub
# serves a reachable SHA) and check out FETCH_HEAD; branches and tags still work.
RUN git init --quiet /tmp/ref \
  && git -C /tmp/ref fetch --quiet --depth 1 \
      https://github.com/bdobb-dev/backends-for-openbb "${REF_BACKEND_REF}" \
  && git -C /tmp/ref checkout --quiet FETCH_HEAD \
  && cp -a /tmp/ref/getting-started/reference-backend/. /app/ \
  && rm -rf /tmp/ref

RUN pip install --no-cache-dir -r requirements.txt websockets

# Make the hard-coded CORS list env-driven (see patch-cors.py), and strip the
# Python Chart omni widget, whose handler exec()s the request body — remote code
# execution on a public, keyless backend (see patch-omni-python.py). The check
# then imports the app and fails the build if /omni-python-widget is still served.
COPY patch-cors.py patch-omni-python.py check-no-exec.py /tmp/
RUN python /tmp/patch-cors.py core.py \
  && python /tmp/patch-omni-python.py widgets_omni_sql_python.py apps.json \
  && python /tmp/check-no-exec.py \
  && rm /tmp/patch-cors.py /tmp/patch-omni-python.py /tmp/check-no-exec.py

# Not root: the app only reads its own files and serves HTTP.
RUN useradd --create-home --uid 10001 app
USER app

EXPOSE 5050
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5050"]
