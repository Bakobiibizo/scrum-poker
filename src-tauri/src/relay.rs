use crate::room::{JiraTicket, Room};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::Message,
    Connector,
};


const DEFAULT_RELAY_URL: &str = "wss://scrum-poker-hydra.ngrok.dev";

/// Messages sent TO the relay server
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutgoingMessage {
    HostRegister,
    HostCreateRoom { name: String },
    HostSyncRoom { room: Room },
    HostDeleteRoom { room_id: String },
    HostRevealVotes { room_id: String },
    HostHideVotes { room_id: String },
    HostResetVotes { room_id: String },
    HostKickParticipant { room_id: String, participant_id: String },
    HostSetTicket { room_id: String, ticket: JiraTicket },
    HostClearTicket { room_id: String },
    Ping,
}

/// Messages received FROM the relay server
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    HostRegistered { rooms: Vec<Room>, relay_url: String },
    RoomCreated { room: Room },
    RoomSynced { room: Room },
    RoomDeleted { room_id: String },
    RoomUpdate { room: Room },
    Error { message: String },
    Pong,
}

/// Relay client state
pub struct RelayClient {
    /// Channel to send messages to the relay
    tx: mpsc::UnboundedSender<OutgoingMessage>,
    /// Current rooms managed by this host
    rooms: Arc<RwLock<Vec<Room>>>,
    /// Relay URL for sharing
    relay_url: Arc<RwLock<String>>,
    /// Connection status
    connected: Arc<RwLock<bool>>,
    /// Callback for room updates
    room_update_callback: Arc<RwLock<Option<Box<dyn Fn(Room) + Send + Sync>>>>,
}

impl RelayClient {
    /// Create a new relay client and connect to the server
    pub async fn connect(relay_url: Option<&str>) -> Result<Arc<Self>, String> {
        let url = relay_url.unwrap_or(DEFAULT_RELAY_URL);
        let ws_url = url::Url::parse(url)
            .map_err(|e| format!("Invalid relay URL: {}", e))?;
        
        tracing::info!("Connecting to relay server: {}", ws_url);
        
        // Create TLS connector using native roots
        let tls_connector = Connector::NativeTls(
            native_tls::TlsConnector::new()
                .map_err(|e| format!("Failed to create TLS connector: {}", e))?
        );
        
        let (ws_stream, _) = connect_async_tls_with_config(
            &ws_url,
            None,
            false,
            Some(tls_connector),
        )
        .await
        .map_err(|e| format!("Failed to connect to relay: {}", e))?;
        
        tracing::info!("Connected to relay server");
        
        let (mut write, mut read) = ws_stream.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<OutgoingMessage>();
        
        let rooms = Arc::new(RwLock::new(Vec::new()));
        let relay_url_storage = Arc::new(RwLock::new(url.to_string()));
        let connected = Arc::new(RwLock::new(true));
        let room_update_callback: Arc<RwLock<Option<Box<dyn Fn(Room) + Send + Sync>>>> = 
            Arc::new(RwLock::new(None));
        
        let client = Arc::new(Self {
            tx,
            rooms: rooms.clone(),
            relay_url: relay_url_storage.clone(),
            connected: connected.clone(),
            room_update_callback: room_update_callback.clone(),
        });
        
        // Spawn task to send messages
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                let json = serde_json::to_string(&msg).unwrap();
                tracing::debug!("Sending to relay: {}", json);
                if write.send(Message::Text(json)).await.is_err() {
                    tracing::error!("Failed to send message to relay");
                    break;
                }
            }
        });
        
        // Spawn task to receive messages
        let rooms_clone = rooms.clone();
        let connected_clone = connected.clone();
        let relay_url_clone = relay_url_storage.clone();
        let callback_clone = room_update_callback.clone();
        
        tokio::spawn(async move {
            while let Some(result) = read.next().await {
                match result {
                    Ok(Message::Text(text)) => {
                        tracing::info!("Received from relay: {}", text);
                        match serde_json::from_str::<IncomingMessage>(&text) {
                            Ok(msg) => match msg {
                                IncomingMessage::HostRegistered { rooms: r, relay_url } => {
                                    tracing::info!("Host registered with {} existing rooms", r.len());
                                    *rooms_clone.write().await = r;
                                    *relay_url_clone.write().await = relay_url;
                                }
                                IncomingMessage::RoomCreated { room } => {
                                    tracing::info!("Room created: {}", room.name);
                                    rooms_clone.write().await.push(room.clone());
                                    if let Some(cb) = callback_clone.read().await.as_ref() {
                                        cb(room);
                                    }
                                }
                                IncomingMessage::RoomSynced { room } => {
                                    tracing::info!("Room synced: {}", room.name);
                                    // Room was synced to relay, no action needed
                                }
                                IncomingMessage::RoomDeleted { room_id } => {
                                    tracing::info!("Room deleted: {}", room_id);
                                    rooms_clone.write().await.retain(|r| r.id != room_id);
                                }
                                IncomingMessage::RoomUpdate { room } => {
                                    tracing::info!("Room update: {} ({} participants)", 
                                        room.name, room.participants.len());
                                    // Update room in list
                                    let mut rooms = rooms_clone.write().await;
                                    if let Some(existing) = rooms.iter_mut().find(|r| r.id == room.id) {
                                        *existing = room.clone();
                                    }
                                    drop(rooms);
                                    if let Some(cb) = callback_clone.read().await.as_ref() {
                                        cb(room);
                                    }
                                }
                                IncomingMessage::Error { message } => {
                                    tracing::error!("Relay error: {}", message);
                                }
                                IncomingMessage::Pong => {
                                    // Keepalive response
                                }
                            },
                            Err(e) => {
                                tracing::error!("Failed to parse relay message: {} - raw: {}", e, text);
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        tracing::info!("Relay connection closed");
                        *connected_clone.write().await = false;
                        break;
                    }
                    Err(e) => {
                        tracing::error!("Relay WebSocket error: {}", e);
                        *connected_clone.write().await = false;
                        break;
                    }
                    _ => {}
                }
            }
        });
        
        // Register as host
        client.send(OutgoingMessage::HostRegister)?;
        
        // Start keepalive
        let tx_clone = client.tx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                if tx_clone.send(OutgoingMessage::Ping).is_err() {
                    break;
                }
            }
        });
        
        Ok(client)
    }
    
    /// Send a message to the relay
    fn send(&self, msg: OutgoingMessage) -> Result<(), String> {
        self.tx.send(msg)
            .map_err(|_| "Failed to send message to relay".to_string())
    }
    
    /// Set callback for room updates
    pub async fn set_room_update_callback<F>(&self, callback: F) 
    where
        F: Fn(Room) + Send + Sync + 'static
    {
        *self.room_update_callback.write().await = Some(Box::new(callback));
    }
    
    /// Get relay URL for sharing
    pub async fn get_relay_url(&self) -> String {
        self.relay_url.read().await.clone()
    }
    
    /// Check if connected
    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }
    
    /// Get all rooms
    pub async fn get_rooms(&self) -> Vec<Room> {
        self.rooms.read().await.clone()
    }
    
    /// Get a specific room
    pub async fn get_room(&self, room_id: &str) -> Option<Room> {
        self.rooms.read().await.iter().find(|r| r.id == room_id).cloned()
    }
    
    /// Create a new room
    pub fn create_room(&self, name: String) -> Result<(), String> {
        self.send(OutgoingMessage::HostCreateRoom { name })
    }
    
    /// Delete a room
    pub fn delete_room(&self, room_id: String) -> Result<(), String> {
        self.send(OutgoingMessage::HostDeleteRoom { room_id })
    }
    
    /// Reveal votes in a room
    pub fn reveal_votes(&self, room_id: String) -> Result<(), String> {
        self.send(OutgoingMessage::HostRevealVotes { room_id })
    }
    
    /// Hide votes in a room
    pub fn hide_votes(&self, room_id: String) -> Result<(), String> {
        self.send(OutgoingMessage::HostHideVotes { room_id })
    }
    
    /// Reset votes in a room
    pub fn reset_votes(&self, room_id: String) -> Result<(), String> {
        self.send(OutgoingMessage::HostResetVotes { room_id })
    }
    
    /// Kick a participant
    pub fn kick_participant(&self, room_id: String, participant_id: String) -> Result<(), String> {
        self.send(OutgoingMessage::HostKickParticipant { room_id, participant_id })
    }
    
    /// Set current ticket for a room
    pub fn set_ticket(&self, room_id: String, ticket: JiraTicket) -> Result<(), String> {
        self.send(OutgoingMessage::HostSetTicket { room_id, ticket })
    }
    
    /// Clear current ticket for a room
    pub fn clear_ticket(&self, room_id: String) -> Result<(), String> {
        self.send(OutgoingMessage::HostClearTicket { room_id })
    }
    
    /// Sync a local room to the relay server
    pub fn sync_room(&self, room: Room) -> Result<(), String> {
        self.send(OutgoingMessage::HostSyncRoom { room })
    }
}
