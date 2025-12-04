# Scrum Poker Relay Server

A WebSocket relay server that enables Scrum Poker to work across the internet without requiring port forwarding.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Desktop App    │◄───────►│  Relay Server   │◄───────►│  Web Clients    │
│  (Room Host)    │   WSS   │  (This Server)  │   WSS   │  (Participants) │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

## Quick Start

### Build

```bash
# Windows
build.bat

# Linux/Mac
chmod +x build.sh
./build.sh
```

### Run Locally

```bash
npm start
```

### Deploy with Docker

```bash
# Build image
docker build -t scrum-poker-relay .

# Run container
docker run -p 8060:8060 \
  -e RELAY_URL=https://scrum-poker.hydra.ngrok.dev \
  scrum-poker-relay
```

### Deploy with Docker Compose

```bash
docker-compose up -d
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port to listen on |
| `RELAY_URL` | `https://scrum-poker.hydra.ngrok.dev` | Public URL of the relay server |

## How It Works

1. **Desktop App** connects to the relay as a "host"
2. **Host** creates rooms, which are stored on the relay
3. **Participants** open the share link (e.g., `https://relay/join/room-id`)
4. **Relay** serves the web client and handles WebSocket connections
5. **Relay** forwards messages between host and participants

## API Endpoints

- `GET /` - Web client (SPA)
- `GET /join/:roomId` - Join room page
- `GET /api/health` - Health check
- `GET /api/room/:roomId` - Get room info
- `GET /api/story-points` - Get available story point values
- `WS /` - WebSocket connection for real-time updates
