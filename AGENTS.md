# Scrum Poker - Development Notes

## Project Overview

Scrum Poker is a Tauri 2.0 desktop application for agile estimation sessions with:
- Desktop host app (Rust + React)
- Web participant client (React)
- Optional relay server for internet access (Node.js)

## Key Architecture Decisions

### Dual Network Mode
- **Local Mode**: Embedded Axum server on port 3030-3050
- **Relay Mode**: Connects to external relay server for internet access
- Users can switch between modes via the Network modal

### Jira Credentials
- Encrypted with AES-256-GCM
- Master password derives key via Argon2
- Stored in user's app data directory

### WebSocket Protocol
- Local mode: `/ws` endpoint on Axum server
- Relay mode: Direct WebSocket to relay server
- Different message formats (see `relay.rs` vs `api.rs`)

## File Reference

| File | Purpose |
|------|---------|
| `src-tauri/src/main.rs` | Tauri commands, app initialization |
| `src-tauri/src/api.rs` | Axum HTTP/WS server for local mode |
| `src-tauri/src/relay.rs` | WebSocket client for relay mode |
| `src-tauri/src/state.rs` | Shared application state |
| `src-tauri/src/room.rs` | Room/Participant data structures |
| `src-tauri/src/credentials.rs` | Encrypted Jira credential storage |
| `src/App.tsx` | Desktop host UI |
| `web-client/src/App.tsx` | Participant voting UI |
| `relay-server/src/server.ts` | Relay server |

## Build Commands

```bash
# Development
npm run tauri dev

# Production build
npm run tauri build

# Type check
cargo check
npm run build
```

## Current Status

- ✅ Desktop app with room management
- ✅ Web client with poker chip voting
- ✅ Jira integration with encrypted credentials
- ✅ Local network sharing
- ✅ Cloud sharing via relay server
- ✅ UPnP automatic port forwarding (optional)

## Known Issues

- Relay server requires separate deployment
- UPnP may not work on all routers

## Relay Server Deployment

Domain: `scrum-poker.hydra.ngrok.dev`

```bash
cd relay-server
docker build -t scrum-poker-relay .
docker run -p 3000:3000 -e RELAY_URL=https://scrum-poker.hydra.ngrok.dev scrum-poker-relay
```
