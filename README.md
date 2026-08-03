# Loza

Encrypted file storage system with a Rust backend and desktop apps (Tauri + iOS). Manages LZEC/LZEA containers, calendar-based organization, and live server monitoring.

![Loza Dashboard](docs/screenshot-dashboard.png)

## Features

- **Encrypted containers** (LZEC / LZEA) — see [docs/loza_format_spec.md](docs/loza_format_spec.md)
- **Calendar UI** with month/agenda views
- **Live server monitoring** — CPU%, RAM%, client connections, storage usage
- **Desktop** (Tauri) and **iOS** (SwiftUI) clients
- **Theme** with automatic dark mode + Liquid Glass (iOS 26.4+)

## Quick Start

### Desktop

```bash
cd app
npm install
npm run dev      # dev server + Vite HMR
npm run tauri    # bundle for macOS / Windows
```

### iOS

```bash
cd ios
open Loza/Loza.xcodeproj   # open in Xcode
# Run on iOS 26.4+ simulator or device
```

### Server

```bash
cd server
cargo run --release
# listens on :3948
```

## Documentation

| Topic                         | File                              |
|-------------------------------|-----------------------------------|
| File formats (LZEC/LZEA)      | [docs/loza_format_spec.md](docs/loza_format_spec.md) |
| Architecture overview         | [docs/architecture.md](docs/architecture.md)          |
| Deployment scripts            | [deploy/README.md](deploy/README.md)                  |

## Development

- **Frontend**: TypeScript + React + Vite — `app/`
- **iOS**: SwiftUI — `ios/Loza/` (targets iOS 26.4)
- **Backend**: Rust — `server/` (see [docs/architecture.md](docs/architecture.md))

## License

See [LICENSE](LICENSE).
