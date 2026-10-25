# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
FROM rust:1.98.1-slim-trixie@sha256:4cd829461bd5c4d511c32e269da9cb8929223b666519d8004e35fc8d1d771ab7 AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl g++ make pkg-config python3 xz-utils && rm -rf /var/lib/apt/lists/*
ARG ICU_SHA256=f06bcab72736ee9d55689033b8198a178562354128cf38edb2afc2e67e3fd931
RUN curl --fail --location --retry 3 https://codeload.github.com/unicode-org/icu/tar.gz/refs/tags/release-78.3 -o /tmp/icu.tar.gz \
 && echo "$ICU_SHA256  /tmp/icu.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/icu.tar.gz -C /tmp \
 && cd /tmp/icu-release-78.3/icu4c/source \
 && ./configure --prefix=/usr/local --disable-samples --disable-tests \
 && make -j4 && make install && ldconfig \
 && mkdir -p /usr/local/share/licenses/icu \
 && cp /tmp/icu-release-78.3/LICENSE /usr/local/share/licenses/icu/LICENSE \
 && rm -rf /tmp/icu*
# Official Node release archives, pinned per supported architecture.
ARG TARGETARCH
RUN case "$TARGETARCH" in \
    arm64) arch=arm64; sha=7a6353f63eb3d04765004b4adf172616243e4522434635cb1d26288658b04ab5 ;; \
    amd64) arch=x64; sha=ca70e9e349de048b9522abb3adc05b3bd6f43c5ffd3ec57916c7da292f59f022 ;; \
    *) exit 1 ;; esac \
 && curl --fail --location --retry 3 "https://nodejs.org/dist/v26.10.0/node-v26.10.0-linux-$arch.tar.xz" -o /tmp/node.tar.xz \
 && echo "$sha  /tmp/node.tar.xz" | sha256sum -c - \
 && mkdir /opt/node && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node && rm /tmp/node.tar.xz
ENV PATH="/opt/node/bin:${PATH}"
WORKDIR /build
COPY . .
ARG BDOBB_SOURCE_REVISION
ARG BDOBB_SOURCE_TREE
# prepare-source.mjs exports the exact locked Git tree and writes this build manifest.
RUN node -e 'const m=require("./.table-source.json"); if(m.revision!==process.argv[1] || m.tree!==process.argv[2] || !/^[a-f0-9]{40}$/.test(m.revision))process.exit(1)' "$BDOBB_SOURCE_REVISION" "$BDOBB_SOURCE_TREE"
RUN npm install --global pnpm@10.34.4 \
 && pnpm install --frozen-lockfile --ignore-scripts \
 && node scripts/build-table-ingest.mjs \
 && mkdir -p /runtime/server/table-ingest/dist /runtime/node_modules \
 && cp server/table-ingest/dist/child.mjs /runtime/server/table-ingest/dist/ \
 && cp -RL node_modules/xlsx /runtime/node_modules/xlsx \
 && node -e 'if(require("./node_modules/xlsx/package.json").version!=="0.20.3")process.exit(1)'
ENV CARGO_TARGET_DIR=/target
RUN cargo build --locked --release --manifest-path crates/pivot-native-worker/Cargo.toml --bin pivot-native-worker \
 && cargo build --locked --release --manifest-path crates/table-service/Cargo.toml --bin table-service \
 && node scripts/build-table-notices.mjs /runtime/licenses/rust

FROM debian:trixie-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libatomic1 libstdc++6 libgcc-s1 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --shell /usr/sbin/nologin table \
 && install -d -m 700 -o 10001 -g 10001 /var/lib/table-service
COPY --from=toolchain /usr/local/lib/libicu*.so* /usr/local/lib/
RUN ldconfig
COPY --from=toolchain /opt/node /opt/node
# The runtime must be able to start Node (ingestion children and the health check), not only the build stage.
RUN /opt/node/bin/node -e 'process.exit(0)'
COPY --from=toolchain /runtime /app
COPY --from=toolchain /target/release/table-service /target/release/pivot-native-worker /app/bin/
COPY --from=toolchain /usr/local/share/licenses/icu /app/licenses/icu
COPY --from=toolchain /opt/node/LICENSE /app/licenses/node-LICENSE
COPY --from=toolchain /build/LICENSE /build/NOTICE /build/THIRD_PARTY_NOTICES.md /app/licenses/
COPY --from=toolchain /build/.table-source.json /app/source.json
COPY deploy/table-service/healthcheck.mjs /app/healthcheck.mjs
ARG BDOBB_SOURCE_REVISION
ARG BDOBB_SOURCE_TREE
LABEL org.opencontainers.image.source="https://github.com/Adventures-OpenBQ/bdobb" \
      org.opencontainers.image.revision="$BDOBB_SOURCE_REVISION" \
      com.bdobb.source-tree="$BDOBB_SOURCE_TREE" \
      com.bdobb.icu="78.3" com.bdobb.node="26.10.0" com.bdobb.rust="1.98.1"
ENV TABLE_SERVICE_CONFIG=/private/settings.json PATH="/opt/node/bin:${PATH}"
USER 10001:10001
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
CMD ["/app/bin/table-service"]
