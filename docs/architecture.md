# Architecture

Loza is a Tauri desktop application with a Rust backend and a React/TypeScript frontend. It manages encrypted file storage (LZEC/LZEA containers) and provides a calendar-based UI for organizing content.

## Project Structure

```
loza/
├── app/                     # Desktop app (frontend + Tauri)
│   ├── src/
│   │   ├── api/             # HTTP clients: auth.ts, serverStatus.ts
│   │   ├── pages/           # React Router pages
│   │   │   ├── auth/        # Login + server setup flow
│   │   │   ├── dashboard/   # Main app UI (calendar, load cards, tabs)
│   │   │   └── ...
│   │   ├── components/      # Reusable UI components
│   │   ├── shared/          # Icons, styles, utils
│   │   └── App.tsx          # Entry: routing + server-configured gate
│   ├── src-tauri/           # Rust backend (commands, window, storage)
│   └── package.json
├── ios/                     # iOS companion app (SwiftUI, iOS 26.4+)
│   ├── Loza/
│   │   ├── LozaApp.swift    # Entry point
│   │   ├── Theme.swift      # Glass style modifiers
│   │   ├── Views/           # SwiftUI views
│   │   └── ...
├── deploy/
│   ├── deploy.sh            # Initial deployment script
│   └── update.sh            # Update existing deployment
└── docs/                    # Documentation
```

## Authentication Flow

1. **`App.tsx`** checks `serverConfigured` from `auth.ts`.
2. If no server configured → shows `ServerSetupPage` (`pages/auth/ServerSetupPage.tsx`).
3. If server is configured → renders `BrowserRouter`:
   - `/auth` → `AuthPage` (login form + "Сменить сервер" button)
   - `/` → `ProtectedRoute` → `DashboardPage`

### Changing Servers (Desktop)

`AuthPage` has a "Сменить сервер" button that calls `clearServerUrl()` from `api/auth.ts` and reloads the page. This clears the stored server address, causing the app to show `ServerSetupPage` on next load.

## Server Status

`app/src/api/serverStatus.ts` fetches server metrics (CPU%, RAM%, clients, storage, activity events) every 5 seconds. These are displayed in `DashboardCards.tsx` → `LoadCard` component.

## LoadCard Precision

CPU and RAM percentages are rounded to **1 decimal place** via `.toFixed(1)` (e.g., `42.9%`).

## iOS App

The iOS app targets **iOS 26.4**. All `#available(iOS 26.0, *)` checks evaluate as always-true. Liquid Glass styles are defined in `Theme.swift`:

| Modifier            | Usage                          |
|---------------------|--------------------------------|
| `.lozaGlass()`      | Card backgrounds, sheets       |
| `.lozaMiniGlass()`  | Toolbar items                 |
| `.lozaBackground()` | Root view background          |
| `.lozaListRowBackground()` | List row backgrounds |
