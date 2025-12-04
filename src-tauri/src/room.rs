use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Story point values available for voting
pub const STORY_POINTS: &[&str] = &["?", "☕", "0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "100"];

/// Jira ticket information
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JiraTicket {
    pub key: String,
    pub summary: String,
    pub description: Option<String>,
    pub issue_type: Option<String>,
    pub status: Option<String>,
    pub url: String,
}

/// Represents a participant in a room
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub id: String,
    pub name: String,
    pub vote: Option<String>,
    pub is_host: bool,
}

impl Participant {
    pub fn new(name: String, is_host: bool) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            vote: None,
            is_host,
        }
    }
}

/// Represents a scrum poker room
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub id: String,
    pub name: String,
    pub participants: Vec<Participant>,
    pub votes_revealed: bool,
    pub created_at: u64,
    pub invite_code: String,
    pub current_ticket: Option<JiraTicket>,
}

impl Room {
    pub fn new(name: String) -> Self {
        let id = Uuid::new_v4().to_string();
        let invite_code = generate_invite_code();
        
        Self {
            id,
            name,
            participants: Vec::new(),
            votes_revealed: false,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            invite_code,
            current_ticket: None,
        }
    }

    pub fn add_participant(&mut self, participant: Participant) {
        self.participants.push(participant);
    }

    pub fn remove_participant(&mut self, participant_id: &str) {
        self.participants.retain(|p| p.id != participant_id);
    }

    pub fn set_vote(&mut self, participant_id: &str, vote: Option<String>) {
        if let Some(participant) = self.participants.iter_mut().find(|p| p.id == participant_id) {
            participant.vote = vote;
        }
    }

    pub fn reset_votes(&mut self) {
        for participant in &mut self.participants {
            participant.vote = None;
        }
        self.votes_revealed = false;
    }

    pub fn get_vote_summary(&self) -> VoteSummary {
        let votes: Vec<&str> = self
            .participants
            .iter()
            .filter_map(|p| p.vote.as_deref())
            .collect();

        let total_voters = self.participants.len();
        let voted_count = votes.len();
        
        let numeric_votes: Vec<f64> = votes
            .iter()
            .filter_map(|v| v.parse::<f64>().ok())
            .collect();

        let average = if numeric_votes.is_empty() {
            None
        } else {
            Some(numeric_votes.iter().sum::<f64>() / numeric_votes.len() as f64)
        };

        VoteSummary {
            total_voters,
            voted_count,
            average,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteSummary {
    pub total_voters: usize,
    pub voted_count: usize,
    pub average: Option<f64>,
}

/// Generate a human-readable invite code (e.g., "51 58 87 72")
fn generate_invite_code() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let uuid = Uuid::new_v4();
    let mut hasher = DefaultHasher::new();
    uuid.hash(&mut hasher);
    let hash = hasher.finish();
    
    format!(
        "{:02} {:02} {:02} {:02}",
        (hash >> 24) & 0xFF,
        (hash >> 16) & 0xFF,
        (hash >> 8) & 0xFF,
        hash & 0xFF
    )
}

/// WebSocket messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsMessage {
    /// Client wants to join a room
    Join { room_id: String, name: String },
    /// Client submits a vote
    Vote { vote: Option<String> },
    /// Server sends room state update
    RoomUpdate { room: Room },
    /// Server sends error
    Error { message: String },
    /// Participant was kicked
    Kicked,
    /// Ping/Pong for keepalive
    Ping,
    Pong,
}
