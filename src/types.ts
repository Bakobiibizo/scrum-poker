/** Jira ticket information */
export interface JiraTicket {
  key: string;
  summary: string;
  description: string | null;
  issue_type: string | null;
  status: string | null;
  url: string;
}

/** Participant in a room */
export interface Participant {
  id: string;
  name: string;
  vote: string | null;
  is_host: boolean;
}

/** Scrum poker room */
export interface Room {
  id: string;
  name: string;
  participants: Participant[];
  votes_revealed: boolean;
  created_at: number;
  invite_code: string;
  current_ticket: JiraTicket | null;
}

/** Vote summary statistics */
export interface VoteSummary {
  total_voters: number;
  voted_count: number;
  average: number | null;
}

/** Story point values */
export const STORY_POINTS = ["?", "☕", "0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "100"];

/** WebSocket message types */
export type WsMessage =
  | { type: "Join"; payload: { room_id: string; name: string } }
  | { type: "Vote"; payload: { vote: string | null } }
  | { type: "RoomUpdate"; payload: { room: Room } }
  | { type: "Error"; payload: { message: string } }
  | { type: "Kicked" }
  | { type: "Ping" }
  | { type: "Pong" };
