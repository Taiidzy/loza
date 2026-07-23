FROM rust:1-bookworm AS builder

WORKDIR /app
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/migrations ./migrations
COPY backend/src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim

RUN useradd --create-home --shell /usr/sbin/nologin loza \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/loza-server /usr/local/bin/loza-server
RUN mkdir -p /data/storage && chown -R loza:loza /data

USER loza
ENV PORT=4242
ENV STORAGE_ROOT=/data/storage
EXPOSE 4242

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health >/dev/null || exit 1

CMD ["loza-server"]
