#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="${LOZA_APP_DIR:-/opt/loza}"
REPO_URL="https://github.com/Taiidzy/loza.git"
BRANCH="${LOZA_BRANCH:-main}"
PORT="${PORT:-4242}"

color() {
  case "$1" in
    INFO) printf '\033[36m';;
    SUCCESS) printf '\033[32m';;
    WARNING) printf '\033[33m';;
    ERROR) printf '\033[31m';;
    DEBUG) printf '\033[90m';;
  esac
}

log() {
  local level="$1"; shift
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  printf '%s[%s]\033[0m %s [%s] %s\n' "$(color "$level")" "$level" "$ts" "installer" "$*"
}

fail() {
  log ERROR "$*"
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [[ -r /dev/urandom ]] && command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  else
    fail "A cryptographically secure random source (openssl or /dev/urandom with od) is required"
  fi
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
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

env_value() {
  local key="$1"
  local file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

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

configure_bootstrap_admin() {
  local env_file="$1"
  local admin_login admin_password confirmation
  local current_login current_password
  current_login="$(env_value BOOTSTRAP_ADMIN_USERNAME "$env_file")"
  current_password="$(env_value BOOTSTRAP_ADMIN_PASSWORD "$env_file")"

  if [[ -n "$current_login" && -n "$current_password" && "$current_password" != "change_me_to_a_long_unique_admin_password" ]]; then
    return
  fi

  log INFO "The database is empty. Create the initial administrator."
  read -r -p "Admin login (3-32 latin letters, digits, _ or -): " admin_login
  [[ "$admin_login" =~ ^[a-zA-Z0-9_-]{3,32}$ ]] || fail "Invalid administrator login"
  admin_login="${admin_login,,}"

  read -r -s -p "Admin password (at least 12 chars; letters, digits, . _ -): " admin_password
  printf '\n'
  [[ "$admin_password" =~ ^[A-Za-z0-9._-]{12,}$ ]] || fail "Password must be at least 12 characters and use only letters, digits, . _ -"
  read -r -s -p "Repeat admin password: " confirmation
  printf '\n'
  [[ "$admin_password" == "$confirmation" ]] || fail "Passwords do not match"

  set_env_value BOOTSTRAP_ADMIN_USERNAME "$admin_login" "$env_file"
  set_env_value BOOTSTRAP_ADMIN_PASSWORD "$admin_password" "$env_file"
  set_env_value BOOTSTRAP_ADMIN_DISPLAY_NAME "$admin_login" "$env_file"
  log SUCCESS "Initial administrator configured"
}

main() {
  need git
  need docker
  need curl

  log INFO "Installing Loza into ${APP_DIR}"
  if [[ ! -d "$APP_DIR/.git" ]]; then
    sudo mkdir -p "$APP_DIR"
    sudo chown "$(id -u):$(id -g)" "$APP_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  else
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  fi

  cd "$APP_DIR"

  if [[ ! -f .env ]]; then
    install -m 600 .env.example .env
    sed -i.bak "s/change_me_to_a_long_random_password/$(random_secret)/" .env
    sed -i.bak "s/change_me_to_a_64_char_random_secret/$(random_secret)/" .env
    rm -f .env.bak
  else
    chmod 600 .env
  fi
  configure_bootstrap_admin .env

  log INFO "Building and starting containers"
  compose up -d --build

  wait_for_health || {
    compose ps
    compose logs --tail=120 backend
    fail "Backend healthcheck did not become ready"
  }

  log SUCCESS "Loza backend is available at http://127.0.0.1:${PORT}"
  log INFO "Container status:"
  compose ps
  log INFO "Update later with: cd ${APP_DIR} && git pull --ff-only && docker compose up -d --build"
}

main "$@"
