# Deployment

## Local development on macOS (Docker)

The repository Compose stack is the only local backend setup: it starts
Postgres and the Rust backend, exposes the backend at `http://127.0.0.1:4242`,
and persists user files in `./storage`. It deliberately does **not** start
Nginx or TLS.

```bash
cp .env.example .env
# edit POSTGRES_PASSWORD, JWT_SECRET and BOOTSTRAP_ADMIN_PASSWORD
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:4242/health
```

On first launch enter `http://127.0.0.1:4242` in the desktop client and sign
in with the bootstrap account from `.env`. Stop the local stack with:

```bash
docker compose down
```

`docker compose down -v` also removes the local Postgres volume; it is an
intentional data reset and does not remove the bind-mounted `./storage`.

The file API uses HTTP for all file contents and mutations. In particular,
`POST /files/batch` performs multi-copy, multi-move, and multi-delete and
returns a result for every selected path; WebSocket `/ws/app` only broadcasts
invalidations so clients re-fetch the authoritative directory listing.
Desktop downloads are streamed directly into the operating-system Downloads
folder, rather than materializing the whole file in the WebView process.

For production, keep using the external Nginx/TLS proxy described in
[`TRANSPORT.md`](TRANSPORT.md). The same client setting derives `ws://` from
an `http://` URL and `wss://` from an `https://` URL.

## Initial Deployment

```bash
deploy/deploy.sh
```

Interactive script that:
1. Copies the desktop app (`./app/dist`) to the target machine
2. Copies systemd service (`loza-server.service`) to `/etc/systemd/system/`
3. Copies config file (`loza-server.yaml`) to `/etc/loza/`
4. Prompts for sudo password (or reads from file: `echo "pass" > ~/.loza_deploy_pw`)
5. Registers Tauri code signing key (if `TAURI_SIGNING_PRIVATE_KEY` is set)

### Flags

| Flag        | Description                     |
|-------------|---------------------------------|
| `-s <file>` | Read sudo password from file    |
| `-t <host>` | Target host (default: `localhost`) |

### Environment Variables (preserved)

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PASSWORD`
- `SERVER_API_KEY`
- `DEPLOY_USER` (default: `loza`)

## Updates

```bash
deploy/update.sh
```

Incremental update script that:
1. `git pull` to fetch latest changes
2. Rebuilds the backend image — including the `share-viewer-web` web interface
   (`dist` inlined into the image, back end serves `/share/:token`, `/share-app/*`
   and `/share/api/*` itself)
3. Recreates the Compose containers (`docker compose up -d`, zero-downtime)
4. Health-checks the API on port `3948`
5. Verifies the share viewer responds (`/share-app/` → 200, `/share` without a
   token → 404)

### Flags

| Flag        | Description                     |
|-------------|---------------------------------|
| `-s <file>` | Read sudo password from file    |

## Troubleshooting

| Symptom            | Cause              | Fix                          |
|--------------------|--------------------|------------------------------|
| `clearServerUrl is not a function` | Missing import | Ensure `import { clearServerUrl } from "../../api/auth"` in AuthPage.tsx |
| Server unreachable after change | Stale service | Run `deploy/update.sh` to restart |
