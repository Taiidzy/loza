# ── Stage 1: share-viewer-web (веб-интерфейс просмотра общих ссылок) ──────
# Собирается в дистрибутив, который runtime-образ кладёт в /app/share-viewer-web/dist.
# Сервер сам найдёт его по SHARE_WEB_DIR и раздаст /share/:token, /share-app/*, /share/api/*.
FROM node:20-alpine AS web-builder
WORKDIR /web
COPY share-viewer-web/package.json share-viewer-web/package-lock.json ./
RUN npm ci
COPY share-viewer-web/vite.config.ts share-viewer-web/tsconfig.json share-viewer-web/index.html ./
COPY share-viewer-web/src ./src
RUN npm run build

# ── Stage 2: Rust backend ──────────────────────────────────────────────────
FROM rust:1-bookworm AS builder

WORKDIR /app
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/migrations ./migrations
COPY backend/src ./src
RUN cargo build --release --locked

# ── Stage 3: runtime ───────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN useradd --create-home --shell /usr/sbin/nologin loza \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/loza-server /usr/local/bin/loza-server
COPY --from=web-builder /web/dist /app/share-viewer-web/dist
RUN mkdir -p /data/storage && chown -R loza:loza /data /app

USER loza
ENV PORT=4242
ENV STORAGE_ROOT=/data/storage
ENV SHARE_WEB_DIR=/app/share-viewer-web/dist
EXPOSE 4242

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health >/dev/null || exit 1

CMD ["loza-server"]