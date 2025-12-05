use crate::relay::RelayClient;
use crate::room::{JiraTicket, Participant, Room, WsMessage};
use dashmap::DashMap;
use std::sync::Arc;
use std::sync::RwLock;
use tokio::sync::mpsc;

/// Jira configuration for API access
#[derive(Debug, Clone, Default)]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
}

/// Connection info for a WebSocket client
pub struct Connection {
    pub participant_id: String,
    pub room_id: String,
    pub sender: mpsc::UnboundedSender<WsMessage>,
}

/// Application state shared across the app
pub struct AppState {
    /// All rooms, keyed by room ID
    pub rooms: DashMap<String, Room>,
    /// Room ID to invite code mapping (for quick lookup)
    pub invite_codes: DashMap<String, String>,
    /// Active WebSocket connections, keyed by participant ID
    pub connections: DashMap<String, Connection>,
    /// Server port (set after server starts)
    pub server_port: RwLock<u16>,
    /// Server IP address
    pub server_ip: RwLock<String>,
    /// Jira configuration
    pub jira_config: RwLock<JiraConfig>,
    /// Whether firewall port is open
    pub firewall_open: RwLock<bool>,
    /// Cached public IP address
    pub public_ip: RwLock<Option<String>>,
    /// Relay client (when connected)
    pub relay_client: tokio::sync::RwLock<Option<Arc<RelayClient>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            rooms: DashMap::new(),
            invite_codes: DashMap::new(),
            connections: DashMap::new(),
            server_port: RwLock::new(0),
            server_ip: RwLock::new(String::new()),
            jira_config: RwLock::new(JiraConfig::default()),
            firewall_open: RwLock::new(false),
            public_ip: RwLock::new(None),
            relay_client: tokio::sync::RwLock::new(None),
        }
    }

    pub fn set_jira_config(&self, base_url: String, email: String, api_token: String) {
        let mut config = self.jira_config.write().unwrap();
        config.base_url = base_url.trim_end_matches('/').to_string();
        config.email = email;
        config.api_token = api_token;
    }

    pub fn get_jira_config(&self) -> JiraConfig {
        self.jira_config.read().unwrap().clone()
    }

    pub fn has_jira_config(&self) -> bool {
        let config = self.jira_config.read().unwrap();
        !config.base_url.is_empty() && !config.email.is_empty() && !config.api_token.is_empty()
    }

    pub fn set_current_ticket(&self, room_id: &str, ticket: Option<JiraTicket>) {
        if let Some(mut room) = self.rooms.get_mut(room_id) {
            room.current_ticket = ticket;
        }
    }

    pub fn create_room(&self, name: String) -> Room {
        let room = Room::new(name);
        let room_id = room.id.clone();
        let invite_code = room.invite_code.clone();
        
        self.rooms.insert(room_id.clone(), room.clone());
        self.invite_codes.insert(invite_code, room_id);
        
        room
    }

    pub fn get_room(&self, room_id: &str) -> Option<Room> {
        self.rooms.get(room_id).map(|r| r.clone())
    }

    pub fn get_room_by_invite(&self, invite_code: &str) -> Option<Room> {
        self.invite_codes
            .get(invite_code)
            .and_then(|room_id| self.get_room(&room_id))
    }

    pub fn get_rooms(&self) -> Vec<Room> {
        self.rooms.iter().map(|r| r.clone()).collect()
    }

    pub fn delete_room(&self, room_id: &str) -> bool {
        if let Some((_, room)) = self.rooms.remove(room_id) {
            self.invite_codes.remove(&room.invite_code);
            
            // Disconnect all participants in this room
            let to_remove: Vec<String> = self
                .connections
                .iter()
                .filter(|c| c.room_id == room_id)
                .map(|c| c.participant_id.clone())
                .collect();
            
            for participant_id in to_remove {
                if let Some((_, conn)) = self.connections.remove(&participant_id) {
                    let _ = conn.sender.send(WsMessage::Kicked);
                }
            }
            
            true
        } else {
            false
        }
    }

    /// Update a room's state from the relay server (participants, votes, etc.)
    /// This is called when the relay server sends a room_update message
    pub fn update_room_from_relay(&self, relay_room: Room) {
        if let Some(mut local_room) = self.rooms.get_mut(&relay_room.id) {
            // Sync participants from relay (relay is authoritative for participant list)
            local_room.participants = relay_room.participants;
            // Sync votes_revealed state
            local_room.votes_revealed = relay_room.votes_revealed;
            // Note: We don't sync current_ticket from relay as it's set locally
            tracing::debug!(
                "Updated local room {} from relay: {} participants",
                local_room.name,
                local_room.participants.len()
            );
        } else {
            tracing::warn!(
                "Received relay update for unknown room: {}",
                relay_room.id
            );
        }
    }

    pub fn add_participant(&self, room_id: &str, participant: Participant) -> Option<String> {
        let participant_id = participant.id.clone();
        
        if let Some(mut room) = self.rooms.get_mut(room_id) {
            room.add_participant(participant);
            Some(participant_id)
        } else {
            None
        }
    }

    pub fn remove_participant(&self, room_id: &str, participant_id: &str) {
        if let Some(mut room) = self.rooms.get_mut(room_id) {
            room.remove_participant(participant_id);
        }
        
        // Also remove connection and notify
        if let Some((_, conn)) = self.connections.remove(participant_id) {
            let _ = conn.sender.send(WsMessage::Kicked);
        }
    }

    pub fn set_vote(&self, room_id: &str, participant_id: &str, vote: Option<String>) {
        if let Some(mut room) = self.rooms.get_mut(room_id) {
            room.set_vote(participant_id, vote);
        }
    }

    pub fn set_votes_revealed(&self, room_id: &str, revealed: bool) {
        if let Some(mut room) = self.rooms.get_mut(room_id) {
            room.votes_revealed = revealed;
        }
    }

    pub fn reset_votes(&self, room_id: &str) {
        if let Some(mut room) = self.rooms.get_mut(room_id) {
            room.reset_votes();
        }
    }

    pub fn register_connection(
        &self,
        participant_id: String,
        room_id: String,
        sender: mpsc::UnboundedSender<WsMessage>,
    ) {
        self.connections.insert(
            participant_id.clone(),
            Connection {
                participant_id,
                room_id,
                sender,
            },
        );
    }

    pub fn unregister_connection(&self, participant_id: &str) {
        self.connections.remove(participant_id);
    }

    /// Broadcast a room update to all connected clients in that room
    pub async fn broadcast_room_update(&self, room_id: &str) {
        if let Some(room) = self.get_room(room_id) {
            tracing::info!(
                "Broadcasting room update for room_id={}, has_ticket={}, connections={}",
                room_id,
                room.current_ticket.is_some(),
                self.connections.iter().filter(|c| c.room_id == room_id).count()
            );
            let message = WsMessage::RoomUpdate { room };
            
            for conn in self.connections.iter() {
                if conn.room_id == room_id {
                    let _ = conn.sender.send(message.clone());
                }
            }
        }
    }

    pub fn get_server_url(&self) -> String {
        let port = *self.server_port.read().unwrap();
        let ip = self.server_ip.read().unwrap().clone();
        
        if ip.is_empty() || port == 0 {
            String::new()
        } else {
            format!("http://{}:{}", ip, port)
        }
    }

    pub fn set_server_info(&self, ip: String, port: u16) {
        *self.server_ip.write().unwrap() = ip;
        *self.server_port.write().unwrap() = port;
    }

    pub fn set_firewall_open(&self, open: bool) {
        *self.firewall_open.write().unwrap() = open;
    }

    pub fn is_firewall_open(&self) -> bool {
        *self.firewall_open.read().unwrap()
    }

    pub fn set_public_ip(&self, ip: Option<String>) {
        *self.public_ip.write().unwrap() = ip;
    }

    pub fn get_public_ip(&self) -> Option<String> {
        self.public_ip.read().unwrap().clone()
    }

    pub fn get_share_url(&self) -> String {
        let port = *self.server_port.read().unwrap();
        
        // If firewall is open and we have a public IP, use that
        if self.is_firewall_open() {
            if let Some(public_ip) = self.get_public_ip() {
                return format!("http://{}:{}", public_ip, port);
            }
        }
        
        // Otherwise use local IP
        self.get_server_url()
    }

    // Relay client methods
    pub async fn set_relay_client(&self, client: Option<Arc<RelayClient>>) {
        *self.relay_client.write().await = client;
    }

    pub async fn get_relay_client(&self) -> Option<Arc<RelayClient>> {
        self.relay_client.read().await.clone()
    }

    pub async fn is_relay_connected(&self) -> bool {
        if let Some(client) = self.relay_client.read().await.as_ref() {
            client.is_connected().await
        } else {
            false
        }
    }
}
