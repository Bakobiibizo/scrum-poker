import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  PlusCircle, 
  Users, 
  Trash2, 
  Eye, 
  EyeOff, 
  RefreshCw,
  Link,
  Server,
  Settings,
  Ticket,
  ExternalLink,
  X,
  FolderOpen,
  LayoutGrid,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Spade,
  Globe,
  Shield,
  ShieldCheck,
  Copy,
  CheckCircle
} from "lucide-react";
import type { Room } from "./types";

interface JiraProject {
  id: string;
  key: string;
  name: string;
}

interface JiraBoard {
  id: number;
  name: string;
  board_type: string;
}

interface JiraIssueInfo {
  key: string;
  summary: string;
  issue_type: string | null;
  status: string | null;
}

function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isOpeningUpnp, setIsOpeningUpnp] = useState(false);
  
  // Jira state
  const [showJiraConfig, setShowJiraConfig] = useState(false);
  const [showJiraUnlock, setShowJiraUnlock] = useState(false);
  const [hasJiraConfig, setHasJiraConfig] = useState(false);
  const [hasStoredCreds, setHasStoredCreds] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraPassword, setJiraPassword] = useState("");
  const [jiraUnlockError, setJiraUnlockError] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [isLoadingTicket, setIsLoadingTicket] = useState(false);
  const [ticketError, setTicketError] = useState("");
  
  // Jira browser state
  const [showJiraBrowser, setShowJiraBrowser] = useState(false);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<JiraProject | null>(null);
  const [jiraBoards, setJiraBoards] = useState<JiraBoard[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<JiraBoard | null>(null);
  const [boardIssues, setBoardIssues] = useState<JiraIssueInfo[]>([]);
  const [isLoadingJira, setIsLoadingJira] = useState(false);
  const [jiraBrowserError, setJiraBrowserError] = useState("");
  
  // Network state
  const [showNetworkInfo, setShowNetworkInfo] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<{
    local_ip: string;
    public_ip: string | null;
    port: number;
    local_url: string;
    public_url: string | null;
    firewall_open: boolean;
  } | null>(null);
  const [isLoadingNetwork, setIsLoadingNetwork] = useState(false);
  
  // Relay state
  const [isRelayConnected, setIsRelayConnected] = useState(false);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  const [isConnectingRelay, setIsConnectingRelay] = useState(false);

  // Fetch rooms and server URL on mount
  useEffect(() => {
    loadRooms();
    loadServerUrl();
    checkJiraConfig();
    checkStoredCredentials();
    checkRelayStatus();
    
    // Poll for updates every 2 seconds
    const interval = setInterval(() => {
      loadRooms();
      if (selectedRoom) {
        loadRoom(selectedRoom.id);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedRoom?.id]);

  const checkJiraConfig = async () => {
    try {
      const configured = await invoke<boolean>("has_jira_config");
      setHasJiraConfig(configured);
    } catch (error) {
      console.error("Failed to check Jira config:", error);
    }
  };

  const checkStoredCredentials = async () => {
    try {
      const hasStored = await invoke<boolean>("has_stored_credentials");
      setHasStoredCreds(hasStored);
    } catch (error) {
      console.error("Failed to check stored credentials:", error);
    }
  };

  const unlockJira = async () => {
    if (!jiraPassword) return;
    setJiraUnlockError("");
    try {
      await invoke("unlock_credentials", { password: jiraPassword });
      setHasJiraConfig(true);
      setShowJiraUnlock(false);
      setJiraPassword("");
    } catch (error) {
      setJiraUnlockError(String(error));
    }
  };

  const saveJiraConfig = async () => {
    if (!jiraPassword) {
      setJiraUnlockError("Password is required to encrypt credentials");
      return;
    }
    try {
      await invoke("save_jira_credentials", {
        password: jiraPassword,
        baseUrl: jiraBaseUrl,
        email: jiraEmail,
        apiToken: jiraToken,
      });
      setHasJiraConfig(true);
      setHasStoredCreds(true);
      setShowJiraConfig(false);
      setJiraPassword("");
      setJiraBaseUrl("");
      setJiraEmail("");
      setJiraToken("");
    } catch (error) {
      console.error("Failed to save Jira config:", error);
    }
  };

  const handleJiraButtonClick = () => {
    if (hasJiraConfig) {
      // Already unlocked, show config to edit
      setShowJiraConfig(true);
    } else if (hasStoredCreds) {
      // Has stored creds, show unlock
      setShowJiraUnlock(true);
    } else {
      // No creds, show config to set up
      setShowJiraConfig(true);
    }
  };

  const logoutJira = async () => {
    try {
      await invoke("logout_jira");
      setHasJiraConfig(false);
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  };

  const fetchTicket = async () => {
    if (!selectedRoom || !ticketKey.trim()) return;
    setIsLoadingTicket(true);
    setTicketError("");
    try {
      await invoke("fetch_jira_ticket", {
        roomId: selectedRoom.id,
        ticketKey: ticketKey.trim().toUpperCase(),
      });
      setTicketKey("");
      loadRoom(selectedRoom.id);
    } catch (error) {
      setTicketError(String(error));
    }
    setIsLoadingTicket(false);
  };

  const clearTicket = async () => {
    if (!selectedRoom) return;
    try {
      await invoke("clear_current_ticket", { roomId: selectedRoom.id });
      loadRoom(selectedRoom.id);
    } catch (error) {
      console.error("Failed to clear ticket:", error);
    }
  };

  // Jira browser functions
  const openJiraBrowser = async () => {
    setShowJiraBrowser(true);
    setSelectedProject(null);
    setSelectedBoard(null);
    setBoardIssues([]);
    setJiraBrowserError("");
    await loadJiraProjects();
  };

  const loadJiraProjects = async () => {
    setIsLoadingJira(true);
    setJiraBrowserError("");
    try {
      const projects = await invoke<JiraProject[]>("list_jira_projects");
      setJiraProjects(projects);
    } catch (error) {
      setJiraBrowserError(String(error));
    }
    setIsLoadingJira(false);
  };

  const selectProject = async (project: JiraProject) => {
    setSelectedProject(project);
    setSelectedBoard(null);
    setBoardIssues([]);
    setIsLoadingJira(true);
    setJiraBrowserError("");
    try {
      const boards = await invoke<JiraBoard[]>("list_jira_boards", { projectKey: project.key });
      setJiraBoards(boards);
    } catch (error) {
      setJiraBrowserError(String(error));
    }
    setIsLoadingJira(false);
  };

  const selectBoard = async (board: JiraBoard) => {
    setSelectedBoard(board);
    setIsLoadingJira(true);
    setJiraBrowserError("");
    try {
      const issues = await invoke<JiraIssueInfo[]>("list_board_issues", { boardId: board.id });
      setBoardIssues(issues);
    } catch (error) {
      setJiraBrowserError(String(error));
    }
    setIsLoadingJira(false);
  };

  const selectIssue = async (issue: JiraIssueInfo) => {
    if (!selectedRoom) return;
    setIsLoadingJira(true);
    try {
      await invoke("fetch_jira_ticket", {
        roomId: selectedRoom.id,
        ticketKey: issue.key,
      });
      loadRoom(selectedRoom.id);
      setShowJiraBrowser(false);
    } catch (error) {
      setJiraBrowserError(String(error));
    }
    setIsLoadingJira(false);
  };

  const goBackInBrowser = () => {
    if (selectedBoard) {
      setSelectedBoard(null);
      setBoardIssues([]);
    } else if (selectedProject) {
      setSelectedProject(null);
      setJiraBoards([]);
    }
  };

  // Network functions
  const loadNetworkInfo = async () => {
    setIsLoadingNetwork(true);
    try {
      const info = await invoke<typeof networkInfo>("get_network_info");
      setNetworkInfo(info);
    } catch (error) {
      console.error("Failed to load network info:", error);
    }
    setIsLoadingNetwork(false);
  };

  const openFirewall = async () => {
    try {
      await invoke("open_firewall_port");
      // Reload network info to check status
      await loadNetworkInfo();
    } catch (error) {
      console.error("Failed to open firewall:", error);
      alert(String(error));
    }
  };

  const checkRelayStatus = async () => {
    try {
      const connected = await invoke<boolean>("is_relay_connected");
      setIsRelayConnected(connected);
      if (connected) {
        const url = await invoke<string | null>("get_relay_url");
        setRelayUrl(url);
      }
    } catch (error) {
      console.error("Failed to check relay status:", error);
    }
  };

  const connectRelay = async () => {
    setIsConnectingRelay(true);
    try {
      await invoke<string>("connect_relay");
      setIsRelayConnected(true);
      const url = await invoke<string | null>("get_relay_url");
      setRelayUrl(url);
    } catch (error) {
      console.error("Failed to connect to relay:", error);
      alert(String(error));
    }
    setIsConnectingRelay(false);
  };

  const disconnectRelay = async () => {
    try {
      await invoke("disconnect_relay");
      setIsRelayConnected(false);
      setRelayUrl(null);
    } catch (error) {
      console.error("Failed to disconnect from relay:", error);
    }
  };

  const loadRooms = async () => {
    try {
      const fetchedRooms = await invoke<Room[]>("get_rooms");
      setRooms(fetchedRooms);
    } catch (error) {
      console.error("Failed to load rooms:", error);
    }
  };

  const loadRoom = async (roomId: string) => {
    try {
      const room = await invoke<Room | null>("get_room", { roomId });
      if (room) {
        setSelectedRoom(room);
      }
    } catch (error) {
      console.error("Failed to load room:", error);
    }
  };

  const loadServerUrl = async () => {
    try {
      // Wait a bit for server to start
      await new Promise(resolve => setTimeout(resolve, 1000));
      const url = await invoke<string>("get_server_url");
      setServerUrl(url);
    } catch (error) {
      console.error("Failed to get server URL:", error);
    }
  };

  const openUpnp = async () => {
    setIsOpeningUpnp(true);
    try {
      const result = await invoke<string>("open_upnp_port");
      alert(result);
      // Reload network info to show updated status
      await loadNetworkInfo();
    } catch (error) {
      console.error("Failed to open UPnP port:", error);
      alert(String(error));
    }
    setIsOpeningUpnp(false);
  };

  const createRoom = async () => {
    if (!newRoomName.trim()) return;
    setIsCreating(true);
    try {
      const room = await invoke<Room>("create_room", { name: newRoomName });
      setRooms([...rooms, room]);
      setSelectedRoom(room);
      setNewRoomName("");
    } catch (error) {
      console.error("Failed to create room:", error);
    }
    setIsCreating(false);
  };

  const deleteRoom = async (roomId: string) => {
    try {
      await invoke<boolean>("delete_room", { roomId });
      setRooms(rooms.filter(r => r.id !== roomId));
      if (selectedRoom?.id === roomId) {
        setSelectedRoom(null);
      }
    } catch (error) {
      console.error("Failed to delete room:", error);
    }
  };

  const revealVotes = async () => {
    if (!selectedRoom) return;
    try {
      await invoke("reveal_votes", { roomId: selectedRoom.id });
      loadRoom(selectedRoom.id);
    } catch (error) {
      console.error("Failed to reveal votes:", error);
    }
  };

  const hideVotes = async () => {
    if (!selectedRoom) return;
    try {
      await invoke("hide_votes", { roomId: selectedRoom.id });
      loadRoom(selectedRoom.id);
    } catch (error) {
      console.error("Failed to hide votes:", error);
    }
  };

  const resetVotes = async () => {
    if (!selectedRoom) return;
    try {
      await invoke("reset_votes", { roomId: selectedRoom.id });
      loadRoom(selectedRoom.id);
    } catch (error) {
      console.error("Failed to reset votes:", error);
    }
  };

  const kickParticipant = async (participantId: string) => {
    if (!selectedRoom) return;
    try {
      await invoke("kick_participant", { 
        roomId: selectedRoom.id, 
        participantId 
      });
      loadRoom(selectedRoom.id);
    } catch (error) {
      console.error("Failed to kick participant:", error);
    }
  };

  const copyInviteLink = () => {
    if (!selectedRoom || !serverUrl) return;
    // Always use local URL - it works for same-network users
    // Users needing public URL can get it from the Network modal
    const link = `${serverUrl}/join/${selectedRoom.id}`;
    navigator.clipboard.writeText(link);
  };

  const getVoteStats = () => {
    if (!selectedRoom) return null;
    
    const votes = selectedRoom.participants
      .map(p => p.vote)
      .filter((v): v is string => v !== null);
    
    const numericVotes = votes
      .map(v => parseFloat(v))
      .filter(v => !isNaN(v));

    if (numericVotes.length === 0) return null;

    const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
    const min = Math.min(...numericVotes);
    const max = Math.max(...numericVotes);

    return { avg: avg.toFixed(1), min, max };
  };

  const stats = selectedRoom?.votes_revealed ? getVoteStats() : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="bg-gray-800/50 backdrop-blur border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Spade className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Scrum Poker</h1>
              <p className="text-gray-400 text-sm">Room Manager</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={handleJiraButtonClick}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors
                        ${hasJiraConfig 
                          ? "bg-blue-600/20 text-blue-300 hover:bg-blue-600/30" 
                          : hasStoredCreds
                            ? "bg-yellow-600/20 text-yellow-300 hover:bg-yellow-600/30"
                            : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
            >
              <Settings className="w-4 h-4" />
              {hasJiraConfig ? "Jira Connected" : hasStoredCreds ? "Unlock Jira" : "Setup Jira"}
            </button>
            {hasJiraConfig && (
              <button
                onClick={logoutJira}
                className="px-2 py-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
              >
                Logout
              </button>
            )}
            <button
              onClick={() => {
                setShowNetworkInfo(true);
                loadNetworkInfo();
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >
              <Globe className="w-4 h-4" />
              Network
            </button>
            <div className="flex items-center gap-2 text-sm">
              <Server className="w-4 h-4 text-gray-400" />
              <span className="text-gray-400">
                {serverUrl || "Starting server..."}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar - Room List */}
        <aside className="w-80 bg-gray-800/30 border-r border-gray-700 flex flex-col">
          {/* Create Room */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createRoom()}
                placeholder="New room name..."
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md 
                         text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                         focus:ring-green-500 focus:border-transparent"
              />
              <button
                onClick={createRoom}
                disabled={isCreating || !newRoomName.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 
                         disabled:cursor-not-allowed rounded-md text-white font-medium 
                         transition-colors flex items-center gap-2"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Room List */}
          <div className="flex-1 overflow-y-auto">
            {rooms.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No rooms yet</p>
                <p className="text-sm">Create one to get started</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    onClick={() => setSelectedRoom(room)}
                    className={`p-3 rounded-md cursor-pointer transition-colors flex items-center justify-between
                              ${selectedRoom?.id === room.id 
                                ? "bg-green-600/20 border border-green-500/50" 
                                : "hover:bg-gray-700/50"}`}
                  >
                    <div>
                      <h3 className="font-medium text-white">{room.name}</h3>
                      <p className="text-sm text-gray-400">
                        {room.participants.length} participant{room.participants.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRoom(room.id);
                      }}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 
                               rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main Content - Room Details */}
        <main className="flex-1 overflow-y-auto">
          {selectedRoom ? (
            <div className="p-6">
              {/* Room Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">{selectedRoom.name}</h2>
                  <p className="text-gray-400">
                    Room Code: <span className="font-mono">{selectedRoom.invite_code}</span>
                  </p>
                </div>
                <button
                  onClick={copyInviteLink}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-white 
                           font-medium transition-colors flex items-center gap-2"
                  title={`Copy: ${serverUrl}/join/${selectedRoom.id}`}
                >
                  <Link className="w-4 h-4" />
                  Copy Invite Link
                </button>
              </div>

              {/* Current Ticket */}
              {selectedRoom.current_ticket ? (
                <div className="bg-blue-900/30 rounded-lg p-4 mb-6 border border-blue-700">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Ticket className="w-5 h-5 text-blue-400" />
                        <a 
                          href={selectedRoom.current_ticket.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 font-mono font-bold hover:underline flex items-center gap-1"
                        >
                          {selectedRoom.current_ticket.key}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {selectedRoom.current_ticket.issue_type && (
                          <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                            {selectedRoom.current_ticket.issue_type}
                          </span>
                        )}
                        {selectedRoom.current_ticket.status && (
                          <span className="px-2 py-0.5 bg-purple-600/30 rounded text-xs text-purple-300">
                            {selectedRoom.current_ticket.status}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-white mb-2">
                        {selectedRoom.current_ticket.summary}
                      </h3>
                      {selectedRoom.current_ticket.description && (
                        <div className="text-gray-300 text-sm whitespace-pre-wrap bg-gray-800/50 rounded p-3 max-h-64 overflow-y-auto">
                          {selectedRoom.current_ticket.description}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={clearTicket}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                      title="Clear ticket"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ) : hasJiraConfig ? (
                <div className="bg-gray-800/50 rounded-lg p-4 mb-6 border border-gray-700">
                  <div className="flex items-center gap-3">
                    <Ticket className="w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={ticketKey}
                      onChange={(e) => setTicketKey(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && fetchTicket()}
                      placeholder="Enter Jira ticket key (e.g., PROJ-123)"
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md 
                               text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                               focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={fetchTicket}
                      disabled={!ticketKey.trim() || isLoadingTicket}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 
                               disabled:cursor-not-allowed rounded-md text-white font-medium 
                               transition-colors"
                    >
                      {isLoadingTicket ? "Loading..." : "Load"}
                    </button>
                    <button
                      onClick={openJiraBrowser}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-md text-white 
                               font-medium transition-colors flex items-center gap-2"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Browse
                    </button>
                  </div>
                  {ticketError && (
                    <p className="mt-2 text-sm text-red-400">{ticketError}</p>
                  )}
                </div>
              ) : null}

              {/* Controls */}
              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={resetVotes}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-white 
                           font-medium transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reset Votes
                </button>
                
                {selectedRoom.votes_revealed ? (
                  <button
                    onClick={hideVotes}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-md text-white 
                             font-medium transition-colors flex items-center gap-2"
                  >
                    <EyeOff className="w-4 h-4" />
                    Hide Votes
                  </button>
                ) : (
                  <button
                    onClick={revealVotes}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-md text-white 
                             font-medium transition-colors flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    Reveal Votes
                  </button>
                )}
              </div>

              {/* Stats */}
              {stats && (
                <div className="bg-gray-800/50 rounded-lg p-4 mb-6 border border-gray-700">
                  <h3 className="text-lg font-semibold text-white mb-3">Vote Statistics</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-green-400">{stats.avg}</p>
                      <p className="text-sm text-gray-400">Average</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-blue-400">{stats.min}</p>
                      <p className="text-sm text-gray-400">Minimum</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-orange-400">{stats.max}</p>
                      <p className="text-sm text-gray-400">Maximum</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Participants */}
              <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Participants ({selectedRoom.participants.length})
                  </h3>
                </div>
                
                {selectedRoom.participants.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">
                    <p>No participants yet</p>
                    <p className="text-sm">Share the invite link to get started</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-700/30">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Name</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-400">Vote</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {selectedRoom.participants.map((participant) => (
                        <tr key={participant.id} className="hover:bg-gray-700/20">
                          <td className="px-4 py-3">
                            <span className="text-white font-medium">{participant.name}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {participant.vote !== null ? (
                              selectedRoom.votes_revealed ? (
                                <span className="inline-flex items-center justify-center w-10 h-10 
                                               rounded-full bg-green-600 text-white font-bold">
                                  {participant.vote}
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-10 h-10 
                                               rounded-full bg-gray-600 text-white">
                                  ✓
                                </span>
                              )
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => kickParticipant(participant.id)}
                              className="px-3 py-1 text-sm text-red-400 hover:text-red-300 
                                       hover:bg-red-500/10 rounded transition-colors"
                            >
                              Kick
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="w-24 h-24 rounded-full bg-gray-800 mx-auto mb-4 flex items-center justify-center">
                  <Spade className="w-12 h-12 text-gray-600" />
                </div>
                <h2 className="text-xl font-medium text-white mb-2">Select a Room</h2>
                <p>Choose a room from the sidebar or create a new one</p>
              </div>
            </div>
          )}
        </main>
      </div>
      {/* Jira Config Modal */}
      {showJiraConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Jira Configuration</h2>
              <button
                onClick={() => setShowJiraConfig(false)}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-gray-400 text-sm mb-4">
              Connect to Jira to load ticket details. You'll need an API token from 
              <a href="https://id.atlassian.com/manage-profile/security/api-tokens" 
                 target="_blank" rel="noopener noreferrer"
                 className="text-blue-400 hover:underline ml-1">Atlassian</a>.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Jira Base URL
                </label>
                <input
                  type="text"
                  value={jiraBaseUrl}
                  onChange={(e) => setJiraBaseUrl(e.target.value)}
                  placeholder="https://yourcompany.atlassian.net"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md 
                           text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                           focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={jiraEmail}
                  onChange={(e) => setJiraEmail(e.target.value)}
                  placeholder="your.email@company.com"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md 
                           text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                           focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  API Token
                </label>
                <input
                  type="password"
                  value={jiraToken}
                  onChange={(e) => setJiraToken(e.target.value)}
                  placeholder="Your Jira API token"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md 
                           text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                           focus:ring-blue-500"
                />
              </div>

              <div className="border-t border-gray-600 pt-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Encryption Password
                </label>
                <input
                  type="password"
                  value={jiraPassword}
                  onChange={(e) => setJiraPassword(e.target.value)}
                  placeholder="Password to encrypt your credentials"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md 
                           text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                           focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Your credentials will be encrypted and saved locally
                </p>
              </div>

              {jiraUnlockError && (
                <p className="text-sm text-red-400">{jiraUnlockError}</p>
              )}
              
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowJiraConfig(false)}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-white 
                           font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveJiraConfig}
                  disabled={!jiraBaseUrl.trim() || !jiraEmail.trim() || !jiraToken.trim() || !jiraPassword.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 
                           disabled:cursor-not-allowed rounded-md text-white font-medium 
                           transition-colors"
                >
                  Save & Encrypt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jira Unlock Modal */}
      {showJiraUnlock && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm border border-gray-700 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Unlock Jira</h2>
              <button
                onClick={() => {
                  setShowJiraUnlock(false);
                  setJiraPassword("");
                  setJiraUnlockError("");
                }}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-gray-400 text-sm mb-4">
              Enter your password to unlock your saved Jira credentials.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={jiraPassword}
                  onChange={(e) => setJiraPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && unlockJira()}
                  placeholder="Your encryption password"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md 
                           text-white placeholder-gray-400 focus:outline-none focus:ring-2 
                           focus:ring-blue-500"
                  autoFocus
                />
              </div>

              {jiraUnlockError && (
                <p className="text-sm text-red-400">{jiraUnlockError}</p>
              )}
              
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowJiraUnlock(false);
                    setShowJiraConfig(true);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-white 
                           font-medium transition-colors text-sm"
                >
                  New Setup
                </button>
                <button
                  onClick={unlockJira}
                  disabled={!jiraPassword.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 
                           disabled:cursor-not-allowed rounded-md text-white font-medium 
                           transition-colors"
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Network Info Modal */}
      {showNetworkInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg border border-gray-700 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Network Information
              </h2>
              <button
                onClick={() => setShowNetworkInfo(false)}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoadingNetwork ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
            ) : networkInfo ? (
              <div className="space-y-4">
                {/* Cloud Sharing (Recommended) */}
                <div className={`rounded-md p-4 border ${isRelayConnected ? 'bg-green-900/30 border-green-600' : 'bg-purple-900/30 border-purple-600'}`}>
                  <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
                    ☁️ Cloud Sharing (Recommended)
                    {isRelayConnected && <span className="text-xs bg-green-600 px-2 py-0.5 rounded">Connected</span>}
                  </h3>
                  {isRelayConnected && relayUrl ? (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <code className="flex-1 bg-gray-900 px-3 py-2 rounded text-green-400 font-mono text-sm">
                          {relayUrl}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(relayUrl)}
                          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
                          title="Copy"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-green-300 mb-3">
                        ✓ Share links work anywhere on the internet - no setup required for participants!
                      </p>
                      <button
                        onClick={disconnectRelay}
                        className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm transition-colors"
                      >
                        Disconnect from Cloud
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-300 mb-3">
                        Enable cloud sharing to let anyone join from anywhere - no router configuration needed!
                      </p>
                      <button
                        onClick={connectRelay}
                        disabled={isConnectingRelay}
                        className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        {isConnectingRelay ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <Globe className="w-4 h-4" />
                            Enable Cloud Sharing
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>

                {/* Local Network */}
                <div className="bg-gray-900/50 rounded-md p-4 border border-gray-700">
                  <h3 className="text-sm font-medium text-gray-400 mb-2">Local Network (Same WiFi/LAN)</h3>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-900 px-3 py-2 rounded text-green-400 font-mono text-sm">
                      {networkInfo.local_url}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(networkInfo.local_url);
                      }}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Use this URL for devices on the same network
                  </p>
                </div>

                {/* Public Internet */}
                <div className="bg-gray-900/50 rounded-md p-4 border border-gray-700">
                  <h3 className="text-sm font-medium text-gray-400 mb-2">Public Internet (External Network)</h3>
                  {networkInfo.public_url ? (
                    <>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-gray-900 px-3 py-2 rounded text-yellow-400 font-mono text-sm">
                          {networkInfo.public_url}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(networkInfo.public_url!);
                          }}
                          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
                          title="Copy"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      
                      {/* UPnP Button */}
                      <div className="mt-3">
                        <button
                          onClick={openUpnp}
                          disabled={isOpeningUpnp}
                          className="w-full px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 
                                   rounded text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                          {isOpeningUpnp ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Opening Port...
                            </>
                          ) : (
                            <>
                              <Globe className="w-4 h-4" />
                              Open Port via UPnP (Automatic)
                            </>
                          )}
                        </button>
                        <p className="text-xs text-gray-500 mt-1">
                          Automatically requests your router to forward the port. Works on most routers with UPnP enabled.
                        </p>
                      </div>
                      
                      <div className="mt-3 p-2 bg-gray-800/50 border border-gray-600 rounded text-xs text-gray-400">
                        <p className="font-semibold mb-1">Manual Alternative: Router Port Forwarding</p>
                        <p>
                          If UPnP doesn't work, log into your router and forward 
                          <span className="font-mono mx-1 text-yellow-400">TCP port {networkInfo.port}</span> 
                          to <span className="font-mono mx-1 text-yellow-400">{networkInfo.local_ip}</span>
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-gray-500 text-sm">Could not determine public IP</p>
                  )}
                </div>

                {/* Firewall Status */}
                <div className="bg-gray-900/50 rounded-md p-4 border border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {networkInfo.firewall_open ? (
                        <ShieldCheck className="w-5 h-5 text-green-400" />
                      ) : (
                        <Shield className="w-5 h-5 text-yellow-400" />
                      )}
                      <span className="text-gray-300">Windows Firewall</span>
                    </div>
                    {networkInfo.firewall_open ? (
                      <span className="text-green-400 text-sm flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" />
                        Port {networkInfo.port} Open
                      </span>
                    ) : (
                      <button
                        onClick={openFirewall}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm transition-colors"
                      >
                        Open Port {networkInfo.port}
                      </button>
                    )}
                  </div>
                  {!networkInfo.firewall_open && (
                    <p className="text-xs text-gray-500 mt-2">
                      Click to add a Windows Firewall rule (requires admin)
                    </p>
                  )}
                </div>

                {/* Troubleshooting */}
                <div className="text-xs text-gray-500 space-y-1">
                  <p><strong>Can't connect?</strong></p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Ensure both devices are on the same network</li>
                    <li>Check that Windows Firewall allows the connection</li>
                    <li>Try disabling VPN if enabled</li>
                    <li>For public access, configure port forwarding on your router</li>
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">Failed to load network info</p>
            )}
          </div>
        </div>
      )}

      {/* Jira Browser Modal */}
      {showJiraBrowser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[80vh] border border-gray-700 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {(selectedProject || selectedBoard) && (
                  <button
                    onClick={goBackInBrowser}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <h2 className="text-xl font-bold text-white">
                  {selectedBoard 
                    ? `${selectedBoard.name} Issues` 
                    : selectedProject 
                      ? `${selectedProject.name} Boards`
                      : "Jira Projects"}
                </h2>
              </div>
              <button
                onClick={() => setShowJiraBrowser(false)}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {jiraBrowserError && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-md text-red-300 text-sm">
                {jiraBrowserError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {isLoadingJira ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                </div>
              ) : selectedBoard ? (
                /* Issues List */
                <div className="space-y-2">
                  {boardIssues.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No issues found</p>
                  ) : (
                    boardIssues.map((issue) => (
                      <button
                        key={issue.key}
                        onClick={() => selectIssue(issue)}
                        className="w-full p-3 bg-gray-700/50 hover:bg-gray-700 rounded-md text-left 
                                 transition-colors flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-blue-400 font-mono text-sm">{issue.key}</span>
                            {issue.issue_type && (
                              <span className="px-2 py-0.5 bg-gray-600 rounded text-xs text-gray-300">
                                {issue.issue_type}
                              </span>
                            )}
                            {issue.status && (
                              <span className="px-2 py-0.5 bg-purple-600/30 rounded text-xs text-purple-300">
                                {issue.status}
                              </span>
                            )}
                          </div>
                          <p className="text-white truncate">{issue.summary}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      </button>
                    ))
                  )}
                </div>
              ) : selectedProject ? (
                /* Boards List */
                <div className="space-y-2">
                  {jiraBoards.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No boards found for this project</p>
                  ) : (
                    jiraBoards.map((board) => (
                      <button
                        key={board.id}
                        onClick={() => selectBoard(board)}
                        className="w-full p-3 bg-gray-700/50 hover:bg-gray-700 rounded-md text-left 
                                 transition-colors flex items-center gap-3"
                      >
                        <LayoutGrid className="w-5 h-5 text-blue-400" />
                        <div className="flex-1">
                          <p className="text-white font-medium">{board.name}</p>
                          <p className="text-sm text-gray-400 capitalize">{board.board_type} board</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      </button>
                    ))
                  )}
                </div>
              ) : (
                /* Projects List */
                <div className="space-y-2">
                  {jiraProjects.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No projects found</p>
                  ) : (
                    jiraProjects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => selectProject(project)}
                        className="w-full p-3 bg-gray-700/50 hover:bg-gray-700 rounded-md text-left 
                                 transition-colors flex items-center gap-3"
                      >
                        <FolderOpen className="w-5 h-5 text-blue-400" />
                        <div className="flex-1">
                          <p className="text-white font-medium">{project.name}</p>
                          <p className="text-sm text-gray-400 font-mono">{project.key}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
