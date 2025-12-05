import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8070;
const RELAY_URL = process.env.RELAY_URL || 'https://scrum-poker-hydra.ngrok.dev';

// Types
interface Room {
  id: string;
  name: string;
  invite_code: string;
  participants: Participant[];
  votes_revealed: boolean;
  current_ticket: JiraTicket | null;
  host_ws: WebSocket | null;
}

interface Participant {
  id: string;
  name: string;
  vote: string | null;
  is_host: boolean;
}

interface JiraTicket {
  key: string;
  summary: string;
  description: string | null;
  issue_type: string | null;
  status: string | null;
  url: string;
}

interface ClientConnection {
  ws: WebSocket;
  type: 'host' | 'participant';
  roomId: string | null;
  participantId: string | null;
}

// State
const rooms = new Map<string, Room>();
const connections = new Map<WebSocket, ClientConnection>();
const inviteCodeToRoom = new Map<string, string>();

// Generate invite code (three random words style)
function generateInviteCode(): string {
  const words = [
    'alpha', 'beta', 'gamma', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
    'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
    'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
    'xray', 'yankee', 'zulu', 'red', 'blue', 'green', 'orange', 'purple',
    'silver', 'golden', 'crystal', 'thunder', 'lightning', 'storm', 'cloud',
    'river', 'mountain', 'ocean', 'forest', 'desert', 'island', 'valley'
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()} ${pick()} ${pick()}`;
}

// Broadcast room update to all participants in a room
function broadcastRoomUpdate(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const message = JSON.stringify({
    type: 'room_update',
    room: {
      id: room.id,
      name: room.name,
      invite_code: room.invite_code,
      participants: room.participants,
      votes_revealed: room.votes_revealed,
      current_ticket: room.current_ticket,
    }
  });

  // Send to host
  if (room.host_ws && room.host_ws.readyState === WebSocket.OPEN) {
    room.host_ws.send(message);
  }

  // Send to all participants
  connections.forEach((conn, ws) => {
    if (conn.roomId === roomId && conn.type === 'participant' && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

// WebSocket handling
wss.on('connection', (ws: WebSocket) => {
  console.log('New WebSocket connection');
  
  const conn: ClientConnection = {
    ws,
    type: 'participant',
    roomId: null,
    participantId: null,
  };
  connections.set(ws, conn);

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(ws, conn, message);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket disconnected');
    handleDisconnect(ws, conn);
    connections.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

function handleMessage(ws: WebSocket, conn: ClientConnection, message: any) {
  console.log('Received message:', message.type);

  switch (message.type) {
    // Host messages
    case 'host_register':
      handleHostRegister(ws, conn);
      break;

    case 'host_create_room':
      handleHostCreateRoom(ws, conn, message);
      break;

    case 'host_delete_room':
      handleHostDeleteRoom(ws, conn, message);
      break;

    case 'host_reveal_votes':
      handleHostRevealVotes(conn, message.room_id, true);
      break;

    case 'host_hide_votes':
      handleHostRevealVotes(conn, message.room_id, false);
      break;

    case 'host_reset_votes':
      handleHostResetVotes(conn, message.room_id);
      break;

    case 'host_kick_participant':
      handleHostKickParticipant(conn, message.room_id, message.participant_id);
      break;

    case 'host_set_ticket':
      handleHostSetTicket(conn, message.room_id, message.ticket);
      break;

    case 'host_clear_ticket':
      handleHostClearTicket(conn, message.room_id);
      break;

    // Participant messages
    case 'join':
      handleParticipantJoin(ws, conn, message);
      break;

    case 'vote':
      handleParticipantVote(conn, message.vote);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
  }
}

function handleHostRegister(ws: WebSocket, conn: ClientConnection) {
  conn.type = 'host';
  console.log('Host registered');
  
  // Send current rooms to host
  const hostRooms = Array.from(rooms.values())
    .filter(r => r.host_ws === ws)
    .map(r => ({
      id: r.id,
      name: r.name,
      invite_code: r.invite_code,
      participants: r.participants,
      votes_revealed: r.votes_revealed,
      current_ticket: r.current_ticket,
    }));

  ws.send(JSON.stringify({
    type: 'host_registered',
    rooms: hostRooms,
    relay_url: RELAY_URL,
  }));
}

function handleHostCreateRoom(ws: WebSocket, conn: ClientConnection, message: any) {
  const roomId = uuidv4();
  const inviteCode = generateInviteCode();
  
  const room: Room = {
    id: roomId,
    name: message.name,
    invite_code: inviteCode,
    participants: [],
    votes_revealed: false,
    current_ticket: null,
    host_ws: ws,
  };

  rooms.set(roomId, room);
  inviteCodeToRoom.set(inviteCode.toLowerCase(), roomId);

  console.log(`Room created: ${room.name} (${roomId})`);

  ws.send(JSON.stringify({
    type: 'room_created',
    room: {
      id: room.id,
      name: room.name,
      invite_code: room.invite_code,
      participants: room.participants,
      votes_revealed: room.votes_revealed,
      current_ticket: room.current_ticket,
    }
  }));
}

function handleHostDeleteRoom(ws: WebSocket, conn: ClientConnection, message: any) {
  const room = rooms.get(message.room_id);
  if (!room || room.host_ws !== ws) return;

  // Notify all participants
  connections.forEach((c, clientWs) => {
    if (c.roomId === message.room_id && c.type === 'participant') {
      clientWs.send(JSON.stringify({ type: 'kicked' }));
    }
  });

  inviteCodeToRoom.delete(room.invite_code.toLowerCase());
  rooms.delete(message.room_id);

  console.log(`Room deleted: ${message.room_id}`);

  ws.send(JSON.stringify({
    type: 'room_deleted',
    room_id: message.room_id,
  }));
}

function handleHostRevealVotes(conn: ClientConnection, roomId: string, revealed: boolean) {
  const room = rooms.get(roomId);
  if (!room || room.host_ws !== conn.ws) return;

  room.votes_revealed = revealed;
  broadcastRoomUpdate(roomId);
}

function handleHostResetVotes(conn: ClientConnection, roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.host_ws !== conn.ws) return;

  room.participants.forEach(p => p.vote = null);
  room.votes_revealed = false;
  broadcastRoomUpdate(roomId);
}

function handleHostKickParticipant(conn: ClientConnection, roomId: string, participantId: string) {
  const room = rooms.get(roomId);
  if (!room || room.host_ws !== conn.ws) return;

  // Find and notify the participant
  connections.forEach((c, ws) => {
    if (c.participantId === participantId && c.roomId === roomId) {
      ws.send(JSON.stringify({ type: 'kicked' }));
      c.roomId = null;
      c.participantId = null;
    }
  });

  room.participants = room.participants.filter(p => p.id !== participantId);
  broadcastRoomUpdate(roomId);
}

function handleHostSetTicket(conn: ClientConnection, roomId: string, ticket: JiraTicket) {
  const room = rooms.get(roomId);
  if (!room || room.host_ws !== conn.ws) return;

  room.current_ticket = ticket;
  broadcastRoomUpdate(roomId);
}

function handleHostClearTicket(conn: ClientConnection, roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.host_ws !== conn.ws) return;

  room.current_ticket = null;
  broadcastRoomUpdate(roomId);
}

function handleParticipantJoin(ws: WebSocket, conn: ClientConnection, message: any) {
  // Find room by ID or invite code
  let room = rooms.get(message.room_id);
  if (!room) {
    // Try invite code
    const normalizedCode = message.room_id.toLowerCase().replace(/-/g, ' ');
    const roomId = inviteCodeToRoom.get(normalizedCode);
    if (roomId) {
      room = rooms.get(roomId);
    }
  }

  if (!room) {
    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
    return;
  }

  const participantId = uuidv4();
  const participant: Participant = {
    id: participantId,
    name: message.name,
    vote: null,
    is_host: false,
  };

  room.participants.push(participant);
  conn.type = 'participant';
  conn.roomId = room.id;
  conn.participantId = participantId;

  console.log(`Participant ${message.name} joined room ${room.name}`);

  // Send join confirmation
  ws.send(JSON.stringify({
    type: 'joined',
    participant_id: participantId,
    room: {
      id: room.id,
      name: room.name,
      invite_code: room.invite_code,
      participants: room.participants,
      votes_revealed: room.votes_revealed,
      current_ticket: room.current_ticket,
    }
  }));

  broadcastRoomUpdate(room.id);
}

function handleParticipantVote(conn: ClientConnection, vote: string | null) {
  if (!conn.roomId || !conn.participantId) return;

  const room = rooms.get(conn.roomId);
  if (!room) return;

  const participant = room.participants.find(p => p.id === conn.participantId);
  if (participant) {
    participant.vote = vote;
    broadcastRoomUpdate(conn.roomId);
  }
}

function handleDisconnect(ws: WebSocket, conn: ClientConnection) {
  if (conn.type === 'host') {
    // Mark all rooms hosted by this connection as having no host
    rooms.forEach((room, roomId) => {
      if (room.host_ws === ws) {
        room.host_ws = null;
        console.log(`Host disconnected from room ${room.name}`);
        // Optionally: notify participants that host disconnected
        // For now, keep the room alive in case host reconnects
      }
    });
  } else if (conn.type === 'participant' && conn.roomId && conn.participantId) {
    const room = rooms.get(conn.roomId);
    if (room) {
      room.participants = room.participants.filter(p => p.id !== conn.participantId);
      console.log(`Participant left room ${room.name}`);
      broadcastRoomUpdate(conn.roomId);
    }
  }
}

// Serve static files (web client)
app.use(express.static(path.join(__dirname, '../public')));

// API endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

app.get('/api/room/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    // Try invite code
    const normalizedCode = req.params.roomId.toLowerCase().replace(/-/g, ' ');
    const roomId = inviteCodeToRoom.get(normalizedCode);
    if (roomId) {
      const foundRoom = rooms.get(roomId);
      if (foundRoom) {
        return res.json({
          id: foundRoom.id,
          name: foundRoom.name,
          invite_code: foundRoom.invite_code,
          participants: foundRoom.participants,
          votes_revealed: foundRoom.votes_revealed,
          current_ticket: foundRoom.current_ticket,
        });
      }
    }
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    id: room.id,
    name: room.name,
    invite_code: room.invite_code,
    participants: room.participants,
    votes_revealed: room.votes_revealed,
    current_ticket: room.current_ticket,
  });
});

app.get('/api/story-points', (req, res) => {
  res.json(['0', '0.5', '1', '2', '3', '5', '8', '13', '21', '?', '☕']);
});

// SPA fallback - serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`Relay server running on port ${PORT}`);
  console.log(`Public URL: ${RELAY_URL}`);
});
