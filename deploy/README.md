# Deployment

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
2. Rebuilds the Rust backend with `cargo build --release`
3. Restarts the systemd service (`loza-server`)
4. Health-checks the API on port `3948`

### Flags

| Flag        | Description                     |
|-------------|---------------------------------|
| `-s <file>` | Read sudo password from file    |

## Troubleshooting

| Symptom            | Cause              | Fix                          |
|--------------------|--------------------|------------------------------|
| `clearServerUrl is not a function` | Missing import | Ensure `import { clearServerUrl } from "../../api/auth"` in AuthPage.tsx |
| Server unreachable after change | Stale service | Run `deploy/update.sh` to restart |
