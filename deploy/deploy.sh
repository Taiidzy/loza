#!/usr/bin/env bash
#
# deploy.sh — One-command Loza deployment.
#
# Usage:
#   ./deploy.sh                          # Fully non-interactive; generates all secrets
#   ./deploy.sh --admin-password 'xyz'   # Provide admin password on CLI (avoid prompt)
#   ./deploy.sh --admin-password-file /path/to/pw.txt  # Read password from file
#   ./deploy.sh --interactive            # Prompt for everything (like old install.sh)
#
# Secrets handled:
#   JWT_SECRET           — auto-generated if JWT_SECRET env is unset
#   POSTGRES_PASSWORD    — auto-generated if POSTGRES_PASSWORD env is unset
#   BOOTSTRAP_ADMIN_*    — configurable via CLI / env / interactive prompt
#
set -Eeuo pipefail
umask 077

# ─── Defaults ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${LOZA_APP_DIR:-/opt/loza}"
REPO_URL="${LOZA_REPO_URL:-https://github.com/Taiidzy/loza.git}"
BRANCH="${LOZA_BRANCH:-main}"
PORT="${PORT:-4242}"

INTERACTIVE=0
ADMIN_PASSWORD=""
ADMIN_PASSWORD_FILE=""
ADMIN_USERNAME="${BOOTSTRAP_ADMIN_USERNAME:-admin}"

# ─── Helpers ─────────────────────────────────────────────────────────────────

color() {
  case "$1" in
    INFO)    printf '\033[36m' ;;
    SUCCESS) printf '\033[32m' ;;
    WARNING) printf '\033[33m' ;;
    ERROR)   printf '\033[31m' ;;
    DEBUG)   printf '\033[90m' ;;
  esac
}

log() {
  local level="$1"; shift
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  printf '%s[%s]\033[0m %s [%s] %s\n' "$(color "$level")" "$level" "$ts" "deploy" "$*"
}

fail() {
  log ERROR "$*"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

rand_hex() { openssl rand -hex "$1"; }

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
    --interactive)
      INTERACTIVE=1
      shift
      ;;
    --admin-password)
      ADMIN_PASSWORD="$2"
      shift 2
      ;;
    --admin-password-file)
      ADMIN_PASSWORD_FILE="$2"
      shift 2
      ;;
    --admin-username)
      ADMIN_USERNAME="$2"
      shift 2
      ;;
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      log ERROR "Unknown argument: $1"
      echo "Usage: deploy.sh [--interactive] [--admin-password 'pw'] [--admin-password-file path]"
      exit 1
      ;;
  esac
done

# ─── Pre-flight ──────────────────────────────────────────────────────────────

need git
need docker
need curl

# ─── Clone / update repo ─────────────────────────────────────────────────────

log INFO "Deploying Loza into ${APP_DIR}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  log INFO "Cloning repository (branch: ${BRANCH})"
  sudo mkdir -p "$APP_DIR"
  sudo chown "$(id -u):$(id -g)" "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  log INFO "Updating existing checkout"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

cd "$APP_DIR"

# ─── Generate / validate .env ────────────────────────────────────────────────

ENV_FILE="${APP_DIR}/.env"

if [[ -f "$ENV_FILE" && ! -v LOZA_FORCE_REGENERATE_ENV ]]; then
  log INFO "Existing .env found; preserving current secrets"
  chmod 600 "$ENV_FILE"
else
  log INFO "Generating .env from template"
  install -m 600 .env.example "$ENV_FILE"
  sed -i.bak "s/change_me_to_a_long_random_password/$(rand_hex 32)/" "$ENV_FILE"
  sed -i.bak "s/change_me_to_a_64_char_random_secret/$(rand_hex 32)/" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
  chmod 600 "$ENV_FILE"
fi

# Helper: set a key=value in .env (handles existence and quoting)
set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  local temp_file
  temp_file="$(mktemp)"
  ENV_VALUE="$value" awk -v key="$key" '
    $0 ~ "^" key "=" { print key "=" ENVIRON["ENV_VALUE"]; found = 1; next }
    { print }
    END { if (!found) print key "=" ENVIRON["ENV_VALUE"] }
  ' "$file" > "$temp_file"
  mv "$temp_file" "$file"
}

# ─── Admin bootstrap configuration ──────────────────────────────────────────

current_password="$(sed -n 's/^BOOTSTRAP_ADMIN_PASSWORD=//p' "$ENV_FILE" | tail -n 1)"
current_login="$(sed -n 's/^BOOTSTRAP_ADMIN_USERNAME=//p' "$ENV_FILE" | tail -n 1)"

needs_admin=0
if [[ -z "$current_login" || -z "$current_password" ]]; then
  needs_admin=1
elif [[ "$current_password" == "change_me_to_a_long_unique_admin_password" ]]; then
  needs_admin=1
fi

if [[ "$needs_admin" -eq 1 || -n "$ADMIN_PASSWORD" || -n "$ADMIN_PASSWORD_FILE" ]]; then
  if [[ -n "$ADMIN_PASSWORD_FILE" ]]; then
    ADMIN_PASSWORD="$(cat "$ADMIN_PASSWORD_FILE")"
  fi

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    if [[ "$INTERACTIVE" -eq 1 ]]; then
      # Interactive prompt
      log INFO "The database is empty. Create the initial administrator."
      read -r -p "Admin login (3-32 chars, letters/digits/_/-): " ADMIN_USERNAME
      [[ "$ADMIN_USERNAME" =~ ^[a-zA-Z0-9_-]{3,32}$ ]] || fail "Invalid administrator login"
      ADMIN_USERNAME="${ADMIN_USERNAME,,}"

      read -r -s -p "Admin password (min 12 chars; letters, digits, . _ -): " ADMIN_PASSWORD
      printf '\n'
      [[ "$ADMIN_PASSWORD" =~ ^[A-Za-z0-9._-]{12,}$ ]] || fail "Password must be ≥12 chars and use only letters, digits, . _ -"
      read -r -s -p "Repeat admin password: " confirmation
      printf '\n'
      [[ "$ADMIN_PASSWORD" == "$confirmation" ]] || fail "Passwords do not match"
    else
      # Auto-generate a strong password
      ADMIN_PASSWORD="$(rand_hex 12)"
      log WARNING "Admin password auto-generated. Save it now — it will not be shown again:"
      log WARNING "  Username: ${ADMIN_USERNAME}"
      log WARNING "  Password: ${ADMIN_PASSWORD}"
    fi
  fi

  set_env_value BOOTSTRAP_ADMIN_USERNAME "$ADMIN_USERNAME" "$ENV_FILE"
  set_env_value BOOTSTRAP_ADMIN_PASSWORD "$ADMIN_PASSWORD" "$ENV_FILE"
  set_env_value BOOTSTRAP_ADMIN_DISPLAY_NAME "$ADMIN_USERNAME" "$ENV_FILE"
  log SUCCESS "Admin bootstrap configured (username: ${ADMIN_USERNAME})"
fi

# ─── Build and start containers ───────────────────────────────────────────────

log INFO "Building and starting containers"
compose up -d --build

if ! wait_for_health; then
  compose logs --tail=120 backend
  fail "Backend did not become healthy"
fi

log SUCCESS "Loza backend is available at http://127.0.0.1:${PORT}"
log INFO "Container status:"
compose ps

log INFO ""
log INFO "Admin login:  http://127.0.0.1:${PORT}/auth/login"
log INFO "To update later:  cd ${APP_DIR} && ./deploy/update.sh"
