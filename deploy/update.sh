#!/usr/bin/env bash
#
# update.sh — Pull latest, rebuild, and restart the Loza backend containers.
#
# Usage:
#   ./update.sh                 # Pull latest, rebuild, restart
#   ./update.sh --no-rebuild    # Pull latest only, restart (reuse existing image)
#   ./update.sh --no-pull       # Skip git pull / docker pull (local edits only)
#   ./update.sh --force         # Force recreate containers (equivalent to up --force-recreate)
#
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${LOZA_APP_DIR:-/opt/loza}"
BRANCH="${LOZA_BRANCH:-main}"
PORT="${PORT:-4242}"

DO_PULL=1
DO_REBUILD=1
FORCE_RECREATE=0

# ─── Helpers ─────────────────────────────────────────────────────────────────

color() {
  case "$1" in
    INFO)    printf '\033[36m' ;;
    SUCCESS) printf '\033[32m' ;;
    WARNING) printf '\033[33m' ;;
    ERROR)   printf '\033[31m' ;;
  esac
}

log() {
  local level="$1"; shift
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  printf '%s[%s]\033[0m %s [%s] %s\n' "$(color "$level")" "$level" "$ts" "update" "$*"
}

fail() {
  log ERROR "$*"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    fail "Docker Compose is not installed"
  fi
}

wait_for_health() {
  local url="http://127.0.0.1:${PORT}/health"
  log INFO "Waiting for backend healthcheck at ${url}"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log SUCCESS "Backend is healthy"
      return 0
    fi
    sleep 2
  done
  log ERROR "Backend healthcheck timed out"
  compose logs --tail=120 backend || true
  return 1
}

# ─── Argument parsing ────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull)     DO_PULL=0;    shift ;;
    --no-rebuild)  DO_REBUILD=0; shift ;;
    --force)       FORCE_RECREATE=1; shift ;;
    --app-dir)
      APP_DIR="$2"; shift 2 ;;
    --)
      shift; break ;;
    *)
      log ERROR "Unknown argument: $1"
      echo "Usage: update.sh [--no-pull] [--no-rebuild] [--force] [--app-dir PATH]"
      exit 1
      ;;
  esac
done

need git
need docker
need curl

cd "$APP_DIR"

# ─── Pull latest code ────────────────────────────────────────────────────────

if [[ "$DO_PULL" -eq 1 ]]; then
  log INFO "Pulling latest code (branch: ${BRANCH})"

  # Stash any local uncommitted changes (with a backup)
  if [[ -n "$(git -C "$APP_DIR" status --porcelain)" ]]; then
    log WARNING "Local changes detected — stashing"
    git -C "$APP_DIR" stash push -m "auto-stash before update at $(date '+%Y-%m-%dT%H:%M:%S')"
    STASHED=1
  else
    STASHED=0
  fi

  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"

  if [[ "$STASHED" -eq 1 ]]; then
    log INFO "Restoring stashed changes (may cause merge conflicts — resolve manually)"
    git -C "$APP_DIR" stash pop || log WARNING "Stash pop failed — check git status"
  fi
fi

# ─── Determine new image tag ─────────────────────────────────────────────────

LATEST_COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
log INFO "New commit: ${LATEST_COMMIT}"

# ─── Build new image ─────────────────────────────────────────────────────────

if [[ "$DO_REBUILD" -eq 1 ]]; then
  log INFO "Building backend image"
  compose build backend
fi

# ─── Recreate containers with zero-downtime where possible ────────────────────

log INFO "Restarting containers"
if [[ "$FORCE_RECREATE" -eq 1 ]]; then
  compose up -d --force-recreate
else
  compose up -d
fi

# ─── Health check ────────────────────────────────────────────────────────────

if ! wait_for_health; then
  fail "Backend did not become healthy after update"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

log SUCCESS "Loza updated successfully (commit: ${LATEST_COMMIT})"
log INFO "Container status:"
compose ps

# Show migration / version info from container logs
log INFO "Recent backend logs:"
compose logs --tail=20 backend || true
