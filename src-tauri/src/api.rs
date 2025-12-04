use crate::room::{Participant, Room, WsMessage, STORY_POINTS};
use crate::state::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{header, Method, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

/// Start the API server
pub async fn start_server(state: Arc<AppState>, _app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Try to get local IP, fallback to localhost
    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    // CORS configuration - allow all origins for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    // Get the path to web-client/dist relative to the executable
    let web_client_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| {
            // In dev mode, go up from target/debug to project root
            if p.ends_with("target\\debug") || p.ends_with("target/debug") {
                p.parent().unwrap().parent().unwrap().join("web-client").join("dist")
            } else {
                p.join("web-client").join("dist")
            }
        })
        .unwrap_or_else(|| std::path::PathBuf::from("web-client/dist"));
    
    tracing::info!("Serving web client from: {:?}", web_client_path);

    let app = Router::new()
        // API routes
        .route("/api/room/:room_id", get(get_room))
        .route("/api/room/invite/:invite_code", get(get_room_by_invite))
        .route("/api/room/:room_id/join", post(join_room))
        .route("/api/story-points", get(get_story_points))
        // WebSocket
        .route("/ws", get(ws_handler))
        // Serve the web client HTML
        .route("/join/:room_id", get(serve_web_client))
        .route("/", get(serve_web_client_root))
        // Serve static assets from web-client/dist
        .nest_service("/assets", ServeDir::new(web_client_path.join("assets")))
        .layer(cors)
        .with_state(state.clone());

    // Try ports starting from 3030
    let mut port = 3030;
    let listener = loop {
        match tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await {
            Ok(l) => break l,
            Err(_) => {
                port += 1;
                if port > 3050 {
                    return Err("Could not find available port".into());
                }
            }
        }
    };

    tracing::info!("API server running on http://{}:{}", local_ip, port);
    state.set_server_info(local_ip, port);

    axum::serve(listener, app).await?;
    Ok(())
}

/// Get a room by ID
async fn get_room(
    State(state): State<Arc<AppState>>,
    Path(room_id): Path<String>,
) -> Response {
    match state.get_room(&room_id) {
        Some(room) => Json(room).into_response(),
        None => (StatusCode::NOT_FOUND, "Room not found").into_response(),
    }
}

/// Get a room by invite code
async fn get_room_by_invite(
    State(state): State<Arc<AppState>>,
    Path(invite_code): Path<String>,
) -> Response {
    // Normalize invite code (remove spaces, handle URL encoding)
    let normalized = invite_code.replace("%20", " ").replace("-", " ");
    
    match state.get_room_by_invite(&normalized) {
        Some(room) => Json(room).into_response(),
        None => (StatusCode::NOT_FOUND, "Room not found").into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct JoinRequest {
    name: String,
}

#[derive(Debug, Serialize)]
struct JoinResponse {
    participant_id: String,
    room: Room,
}

/// Join a room as a participant
async fn join_room(
    State(state): State<Arc<AppState>>,
    Path(room_id): Path<String>,
    Json(req): Json<JoinRequest>,
) -> Response {
    let participant = Participant::new(req.name, false);
    let participant_id = participant.id.clone();
    
    if state.add_participant(&room_id, participant).is_some() {
        // Broadcast the update to all connected clients
        state.broadcast_room_update(&room_id).await;
        
        if let Some(room) = state.get_room(&room_id) {
            return Json(JoinResponse { participant_id, room }).into_response();
        }
    }
    
    (StatusCode::NOT_FOUND, "Room not found").into_response()
}

/// Get available story point values
async fn get_story_points() -> Json<Vec<&'static str>> {
    Json(STORY_POINTS.to_vec())
}

/// WebSocket upgrade handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_websocket(socket, state))
}

/// Handle WebSocket connection
async fn handle_websocket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<WsMessage>();
    
    let mut participant_id: Option<String> = None;
    let mut room_id: Option<String> = None;

    // Spawn task to forward messages from channel to websocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Ok(text) = serde_json::to_string(&msg) {
                if sender.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Handle incoming messages
    while let Some(result) = receiver.next().await {
        match result {
            Ok(Message::Text(text)) => {
                if let Ok(msg) = serde_json::from_str::<WsMessage>(&text) {
                    match msg {
                        WsMessage::Join { room_id: rid, name } => {
                            // Create participant and join room
                            let participant = Participant::new(name, false);
                            let pid = participant.id.clone();
                            
                            if state.add_participant(&rid, participant).is_some() {
                                participant_id = Some(pid.clone());
                                room_id = Some(rid.clone());
                                
                                // Register connection
                                state.register_connection(pid, rid.clone(), tx.clone());
                                
                                // Send room update to all
                                state.broadcast_room_update(&rid).await;
                            } else {
                                let _ = tx.send(WsMessage::Error {
                                    message: "Room not found".to_string(),
                                });
                            }
                        }
                        WsMessage::Vote { vote } => {
                            if let (Some(pid), Some(rid)) = (&participant_id, &room_id) {
                                state.set_vote(rid, pid, vote);
                                state.broadcast_room_update(rid).await;
                            }
                        }
                        WsMessage::Ping => {
                            let _ = tx.send(WsMessage::Pong);
                        }
                        _ => {}
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => {}
        }
    }

    // Cleanup on disconnect
    if let (Some(pid), Some(rid)) = (participant_id, room_id) {
        state.unregister_connection(&pid);
        state.remove_participant(&rid, &pid);
        state.broadcast_room_update(&rid).await;
    }

    send_task.abort();
}

/// Serve the web client HTML (embedded or redirect to dev server)
async fn serve_web_client_root() -> Html<&'static str> {
    serve_web_client(Path(String::new())).await
}

async fn serve_web_client(Path(_room_id): Path<String>) -> Html<&'static str> {
    Html(include_str!("../../web-client/dist/index.html"))
}

