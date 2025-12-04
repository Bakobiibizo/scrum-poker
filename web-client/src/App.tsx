import { useEffect, useState, useRef, useCallback } from "react";
import { Users, LogOut, Check, Ticket, ExternalLink, Spade } from "lucide-react";
import type { Room } from "./types";
import { STORY_POINTS } from "./types";

/** Get chip color based on value */
function getChipColor(value: string): string {
  const numValue = parseFloat(value);
  if (value === "?" || value === "☕") return "chip-white";
  if (numValue === 0) return "chip-black";
  if (numValue <= 1) return "chip-blue";
  if (numValue <= 3) return "chip-green";
  if (numValue <= 8) return "chip-red";
  if (numValue <= 20) return "chip-purple";
  return "chip-gold";
}

/** Get chip size based on value */
function getChipSize(value: string): string {
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return "w-16 h-16 text-lg";
  if (numValue >= 40) return "w-20 h-20 text-xl";
  if (numValue >= 13) return "w-18 h-18 text-lg";
  return "w-16 h-16 text-lg";
}

interface PokerChipProps {
  value: string;
  selected?: boolean;
  onClick?: () => void;
  revealed?: boolean;
  mini?: boolean;
}

function PokerChip({ value, selected, onClick, revealed, mini }: PokerChipProps) {
  const colorClass = getChipColor(value);
  const sizeClass = mini ? "w-10 h-10 text-sm" : getChipSize(value);
  
  return (
    <button
      onClick={onClick}
      className={`poker-chip ${sizeClass} ${selected ? "selected" : ""} ${revealed ? "chip-reveal" : ""}`}
      disabled={!onClick}
    >
      <div className={`poker-chip-inner ${colorClass}`}>
        {value}
      </div>
    </button>
  );
}

type AppState = "join" | "lobby";

function App() {
  const [appState, setAppState] = useState<AppState>("join");
  const [roomId, setRoomId] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  const [participantId, setParticipantId] = useState<string>("");
  const [userName, setUserName] = useState("");
  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Extract room ID from URL path
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/\/join\/([^/]+)/);
    if (match) {
      setRoomId(match[1]);
    }
  }, []);

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    // Use wss:// for https, ws:// for http
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log("WebSocket connected");
      setIsConnecting(false);
      
      // Join the room (relay server format)
      ws.send(JSON.stringify({
        type: "join",
        room_id: roomId,
        name: userName
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("Received:", message.type);
        
        switch (message.type) {
          case "joined":
            // Initial join confirmation
            console.log("Joined room:", message.room);
            setParticipantId(message.participant_id);
            setRoom(message.room);
            break;
          case "room_update":
            console.log("Room update received:", message.room);
            setRoom(message.room);
            // Find our vote
            const me = message.room.participants.find(
              (p: any) => p.id === participantId || p.name === userName
            );
            if (me) {
              if (!participantId) setParticipantId(me.id);
              setSelectedVote(me.vote);
            }
            break;
          case "error":
            console.error("Server error:", message.message);
            setError(message.message);
            setAppState("join");
            wsRef.current?.close();
            break;
          case "kicked":
            setError("You have been removed from the room");
            setAppState("join");
            wsRef.current?.close();
            break;
          case "pong":
            // Keepalive response
            break;
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = () => {
      setError("Connection error. Please try again.");
      setIsConnecting(false);
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      if (appState === "lobby") {
        // Try to reconnect after a delay
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectWebSocket();
        }, 8060);
      }
    };

    wsRef.current = ws;
  }, [roomId, userName, appState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, []);

  // Keepalive ping
  useEffect(() => {
    if (appState !== "lobby") return;
    
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [appState]);

  const handleJoin = async () => {
    if (!userName.trim() || !roomId) return;
    
    setError("");
    setIsConnecting(true);
    setAppState("lobby");
    connectWebSocket();
  };

  const handleVote = (value: string) => {
    const newVote = selectedVote === value ? null : value;
    setSelectedVote(newVote);
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "vote",
        vote: newVote
      }));
    }
  };

  const handleLeave = () => {
    wsRef.current?.close();
    setAppState("join");
    setRoom(null);
    setSelectedVote(null);
    setParticipantId("");
  };

  const currentParticipant = room?.participants.find((p) => p.id === participantId);
  const otherParticipants = room?.participants.filter((p) => p.id !== participantId) ?? [];
  const votedCount = room?.participants.filter((p) => p.vote !== null).length ?? 0;
  const totalParticipants = room?.participants.length ?? 0;

  // Calculate stats when revealed
  const getStats = () => {
    if (!room?.votes_revealed) return null;
    
    const numericVotes = room.participants
      .map((p) => p.vote)
      .filter((v): v is string => v !== null)
      .map((v) => parseFloat(v))
      .filter((v) => !isNaN(v));

    if (numericVotes.length === 0) return null;

    return {
      avg: (numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length).toFixed(1),
      min: Math.min(...numericVotes),
      max: Math.max(...numericVotes),
    };
  };

  const stats = getStats();

  // Join screen
  if (appState === "join") {
    return (
      <div className="min-h-screen felt-bg relative flex items-center justify-center p-4">
        <div className="bg-gray-900/90 backdrop-blur rounded-xl p-8 w-full max-w-md border border-gray-700 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
              <span className="text-4xl">🎰</span>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Scrum Poker</h1>
            <p className="text-gray-400">Place your bets on story points</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-md text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Your Name
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md 
                         text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                         focus:ring-green-500 focus:border-transparent transition-all"
                autoFocus
              />
            </div>

            <button
              onClick={handleJoin}
              disabled={!userName.trim() || !roomId || isConnecting}
              className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 
                       hover:from-green-500 hover:to-emerald-500 disabled:from-gray-600 
                       disabled:to-gray-600 disabled:cursor-not-allowed rounded-md text-white 
                       font-semibold transition-all shadow-lg hover:shadow-green-500/20"
            >
              {isConnecting ? "Joining..." : "Join Room"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Lobby / Voting screen
  return (
    <div className="min-h-screen felt-bg relative flex flex-col">
      {/* Header */}
      <header className="bg-gray-900/80 backdrop-blur border-b border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Spade className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">{room?.name ?? "Loading..."}</h1>
              <p className="text-xs text-gray-400">Room {room?.invite_code}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <Users className="w-4 h-4" />
              <span>{votedCount}/{totalParticipants} voted</span>
            </div>
            <button
              onClick={handleLeave}
              className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
              title="Leave room"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content - Two column layout */}
      <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 max-w-7xl mx-auto w-full">
        {/* Left Column - Ticket Display */}
        <div className="lg:w-1/2 flex flex-col gap-4">
          {room?.current_ticket ? (
            <div className="bg-blue-900/30 backdrop-blur rounded-md p-4 border border-blue-700 flex-1">
              <div className="flex items-center gap-2 mb-3">
                <Ticket className="w-5 h-5 text-blue-400" />
                <a 
                  href={room.current_ticket.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 font-mono font-bold hover:underline flex items-center gap-1"
                >
                  {room.current_ticket.key}
                  <ExternalLink className="w-3 h-3" />
                </a>
                {room.current_ticket.issue_type && (
                  <span className="px-2 py-0.5 bg-green-600/30 border border-green-600/50 rounded text-xs text-green-300">
                    {room.current_ticket.issue_type}
                  </span>
                )}
                {room.current_ticket.status && (
                  <span className="px-2 py-0.5 bg-purple-600/30 border border-purple-600/50 rounded text-xs text-purple-300">
                    {room.current_ticket.status}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-white mb-3">
                {room.current_ticket.summary}
              </h3>
              {room.current_ticket.description && (
                <div className="text-gray-300 text-sm whitespace-pre-wrap bg-gray-900/60 rounded-md p-4 max-h-[50vh] overflow-y-auto border border-gray-700/50">
                  {room.current_ticket.description}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-900/40 backdrop-blur rounded-md p-8 border border-gray-700 flex-1 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <Ticket className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No ticket loaded</p>
                <p className="text-sm">Waiting for host to select a ticket...</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Story Points & Chips */}
        <div className="lg:w-1/2 flex flex-col gap-4">
          {/* Story Points Reference */}
          <div className="bg-gray-900/60 backdrop-blur rounded-md border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/80">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-300">Points</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-300">Hours</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-300">Typical Task</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                <tr className="hover:bg-gray-800/30">
                  <td className="px-3 py-1 text-white font-medium">0.5</td>
                  <td className="px-3 py-1 text-gray-400">~2.5h</td>
                  <td className="px-3 py-1 text-gray-400">quick fix, small config</td>
                </tr>
                <tr className="hover:bg-gray-800/30">
                  <td className="px-3 py-1 text-white font-medium">1</td>
                  <td className="px-3 py-1 text-gray-400">~5h</td>
                  <td className="px-3 py-1 text-gray-400">small story or test</td>
                </tr>
                <tr className="hover:bg-gray-800/30">
                  <td className="px-3 py-1 text-white font-medium">2</td>
                  <td className="px-3 py-1 text-gray-400">~10h</td>
                  <td className="px-3 py-1 text-gray-400">simple change, limited deps</td>
                </tr>
                <tr className="hover:bg-gray-800/30">
                  <td className="px-3 py-1 text-white font-medium">3</td>
                  <td className="px-3 py-1 text-gray-400">~15h</td>
                  <td className="px-3 py-1 text-gray-400">moderate, light coordination</td>
                </tr>
                <tr className="hover:bg-gray-800/30">
                  <td className="px-3 py-1 text-white font-medium">5</td>
                  <td className="px-3 py-1 text-gray-400">~25h</td>
                  <td className="px-3 py-1 text-gray-400">larger change or integration</td>
                </tr>
                <tr className="hover:bg-gray-800/30">
                  <td className="px-3 py-1 text-white font-medium">8</td>
                  <td className="px-3 py-1 text-gray-400">~40h</td>
                  <td className="px-3 py-1 text-gray-400">multi-day, multi-system</td>
                </tr>
                <tr className="hover:bg-gray-800/30">
                  <td className="px-3 py-1 text-white font-medium">13</td>
                  <td className="px-3 py-1 text-gray-400">~65h</td>
                  <td className="px-3 py-1 text-gray-400">epic-sized (split soon)</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Chip Selection */}
          <div className="bg-gray-900/40 backdrop-blur rounded-md p-4 border border-gray-700 flex-1">
            <div className="text-center mb-4">
              {room?.votes_revealed ? (
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-white">Votes Revealed!</h2>
                  {stats && (
                    <div className="flex items-center justify-center gap-4 text-sm">
                      <span className="text-gray-300">
                        Avg: <span className="text-green-400 font-bold">{stats.avg}</span>
                      </span>
                      <span className="text-gray-300">
                        Range: <span className="text-blue-400 font-bold">{stats.min}</span>-<span className="text-orange-400 font-bold">{stats.max}</span>
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-white">Place Your Bet</h2>
                  <p className="text-gray-400 text-sm">
                    {votedCount === totalParticipants && totalParticipants > 0
                      ? "Everyone voted! Waiting for reveal..." 
                      : "Select a chip to vote"}
                  </p>
                </div>
              )}
            </div>

            {/* Poker chips */}
            {!room?.votes_revealed && (
              <div className="flex flex-wrap justify-center gap-3">
                {STORY_POINTS.map((value) => (
                  <PokerChip
                    key={value}
                    value={value}
                    selected={selectedVote === value}
                    onClick={() => handleVote(value)}
                  />
                ))}
              </div>
            )}

            {/* Your vote indicator */}
            {currentParticipant?.vote && !room?.votes_revealed && (
              <div className="flex items-center justify-center gap-2 mt-4 text-green-400 text-sm">
                <Check className="w-4 h-4" />
                <span>You voted: <strong>{currentParticipant.vote}</strong></span>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Bottom Bar - Participants */}
      <footer className="bg-gray-900/80 backdrop-blur border-t border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">Participants ({totalParticipants})</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {/* Current user first */}
            {currentParticipant && (
              <ParticipantCard
                name={currentParticipant.name}
                vote={currentParticipant.vote}
                revealed={room?.votes_revealed ?? false}
                isYou={true}
              />
            )}
            
            {/* Other participants */}
            {otherParticipants.map((participant) => (
              <ParticipantCard
                key={participant.id}
                name={participant.name}
                vote={participant.vote}
                revealed={room?.votes_revealed ?? false}
                isYou={false}
              />
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

interface ParticipantCardProps {
  name: string;
  vote: string | null;
  revealed: boolean;
  isYou: boolean;
}

function ParticipantCard({ name, vote, revealed, isYou }: ParticipantCardProps) {
  return (
    <div className={`flex flex-col items-center gap-2 p-3 rounded-md ${isYou ? "bg-green-500/10 border border-green-500/30" : "bg-gray-800/50"}`}>
      <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-lg font-bold text-white">
        {name.charAt(0).toUpperCase()}
      </div>
      <span className={`text-sm font-medium truncate max-w-full ${isYou ? "text-green-300" : "text-gray-300"}`}>
        {name} {isYou && "(You)"}
      </span>
      <div className="h-12 flex items-center justify-center">
        {vote !== null ? (
          revealed ? (
            <PokerChip value={vote} mini revealed />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white text-lg">
              ✓
            </div>
          )
        ) : (
          <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs">
            ?
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
