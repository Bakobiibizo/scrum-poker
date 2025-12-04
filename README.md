# Scrum Poker 🎰

A Windows desktop application for Scrum Poker / Planning Poker sessions with a casino-style poker chip theme.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![Tauri](https://img.shields.io/badge/Tauri-2.0-blue.svg)

## Features

- **Desktop App (Host)**: Create and manage poker rooms, reveal/hide votes, kick participants
- **Web Client (Participants)**: Join via invite link, vote using poker chips
- **Real-time Updates**: WebSocket-based live synchronization
- **Jira Integration**: Load tickets directly from Jira with secure credential storage
- **Cloud Sharing**: Share rooms across the internet via relay server (no port forwarding needed!)
- **Local Network**: Direct connection for same-network participants
- **Casino Theme**: Stylish poker chip UI with color-coded values

## Screenshots

```
┌─────────────────────────────────────────────────────────────┐
│  🎰 Scrum Poker                              [Network] [⚙]  │
├─────────────────────────────────────────────────────────────┤
│  Rooms                     │  Sprint Planning Room          │
│  ┌──────────────────────┐  │  ┌────────────────────────────┐│
│  │ Sprint Planning      │  │  │ PROJ-123: User login flow  ││
│  │ Backlog Grooming     │  │  │ As a user, I want to...    ││
│  └──────────────────────┘  │  └────────────────────────────┘│
│                            │  Participants: Alice ✓ Bob ✓   │
│  [+ New Room]              │  [Reveal] [Reset] [Copy Link]  │
└─────────────────────────────────────────────────────────────┘
```

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Desktop App    │◄───────►│  Relay Server   │◄───────►│  Web Clients    │
│  (Room Host)    │   WSS   │  (Optional)     │   WSS   │  (Participants) │
└─────────────────┘         └─────────────────┘         └─────────────────┘
        │                                                        │
        │ Local Network Mode                                     │
        └────────────────────────────────────────────────────────┘
```

- **Desktop App**: Tauri 2.0 (Rust backend + React frontend)
- **API Server**: Axum with WebSocket support (embedded in desktop app)
- **Web Client**: React + TailwindCSS (served by API or standalone)
- **Relay Server**: Node.js + Express + WS (optional, for internet access)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/scrum-poker.git
cd scrum-poker

# Install dependencies
npm install
cd web-client && npm install && cd ..

# Build the web client
cd web-client && npm run build && cd ..

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

The built application will be in `src-tauri/target/release/`.

## Usage

### As Host (Desktop App)

1. Launch the Scrum Poker application
2. Create a new room with a name
3. **(Optional)** Configure Jira integration to load tickets
4. **(Optional)** Enable Cloud Sharing for internet access
5. Copy the invite link and share with participants
6. Load a Jira ticket or let participants discuss
7. Wait for participants to join and vote
8. Click **"Reveal Votes"** when everyone has voted
9. Click **"Reset Votes"** to start a new round

### As Participant (Web Client)

1. Open the invite link in a browser
2. Enter your name
3. Click **"Join Room"**
4. View the ticket description
5. Select a poker chip to vote
6. Wait for the host to reveal votes

## Network Sharing Options

### Local Network (Same WiFi/LAN)
- Works out of the box
- Share the local IP URL with participants
- All devices must be on the same network

### Cloud Sharing (Recommended for Remote Teams)
1. Deploy the relay server (see `relay-server/README.md`)
2. Click **Network** → **Enable Cloud Sharing**
3. Share links work anywhere on the internet!

### Manual Port Forwarding
1. Click **Network** → **Open Firewall**
2. Configure your router to forward the port
3. Share the public IP URL

## Jira Integration

1. Click the **gear icon** (⚙) to configure Jira
2. Enter your Jira instance URL (e.g., `https://yourcompany.atlassian.net`)
3. Enter your email and [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
4. Set a master password to encrypt credentials
5. Browse projects, boards, and load tickets directly

Credentials are encrypted with AES-256-GCM and stored locally.

## Story Points Reference

| Points | Hours | Typical Task |
|--------|-------|--------------|
| 0.5 | ~2.5h | Quick fix, small config |
| 1 | ~5h | Small story or test |
| 2 | ~10h | Simple change, limited deps |
| 3 | ~15h | Moderate, light coordination |
| 5 | ~25h | Larger change or integration |
| 8 | ~40h | Multi-day, multi-system |
| 13 | ~65h | Epic-sized (split soon) |

Special values:
- **?** - Unknown / Need discussion
- **☕** - Break / Coffee

## Project Structure

```
scrum-poker/
├── src/                    # Desktop app React frontend
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Tauri commands
│   │   ├── api.rs          # Axum HTTP/WS server
│   │   ├── room.rs         # Room data structures
│   │   ├── state.rs        # Application state
│   │   ├── relay.rs        # Relay client
│   │   └── credentials.rs  # Encrypted credential storage
│   └── Cargo.toml
├── web-client/             # Participant web client
│   └── src/
│       └── App.tsx         # Voting UI
├── relay-server/           # Optional relay server
│   ├── src/
│   │   └── server.ts       # WebSocket relay
│   ├── Dockerfile
│   └── README.md
└── package.json
```

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/room/:id` | Get room details |
| GET | `/api/room/invite/:code` | Get room by invite code |
| POST | `/api/room/:id/join` | Join a room |
| GET | `/api/story-points` | Get available point values |

### WebSocket Messages

```typescript
// Client → Server
{ type: "Join", payload: { room_id: string, name: string } }
{ type: "Vote", payload: { vote: string | null } }
{ type: "Ping" }

// Server → Client
{ type: "RoomUpdate", payload: { room: Room } }
{ type: "Error", payload: { message: string } }
{ type: "Kicked" }
{ type: "Pong" }
```

## Development

### Running Tests

```bash
# Rust tests
cd src-tauri && cargo test

# TypeScript type check
npm run build
```

### Building the Relay Server

```bash
cd relay-server
npm install
npm run build
npm start
```

Or with Docker:

```bash
cd relay-server
docker build -t scrum-poker-relay .
docker run -p 8060:8060 -e RELAY_URL=https://your-domain.com scrum-poker-relay
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop app framework
- [Axum](https://github.com/tokio-rs/axum) - Web framework
- [React](https://reactjs.org/) - UI library
- [TailwindCSS](https://tailwindcss.com/) - Styling
- [Lucide](https://lucide.dev/) - Icons
