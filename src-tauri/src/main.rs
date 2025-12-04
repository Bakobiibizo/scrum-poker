#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod credentials;
mod relay;
mod room;
mod state;

use room::JiraTicket;
use state::AppState;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};

fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .init();

    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        .manage(app_state.clone())
        .setup(move |app| {
            let state = app_state.clone();
            let app_handle = app.handle().clone();
            
            // Start the API server in a background thread
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
                rt.block_on(async {
                    if let Err(e) = api::start_server(state, app_handle).await {
                        tracing::error!("API server error: {}", e);
                    }
                });
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_room,
            get_rooms,
            get_room,
            delete_room,
            reveal_votes,
            hide_votes,
            reset_votes,
            get_server_url,
            kick_participant,
            set_jira_config,
            has_jira_config,
            fetch_jira_ticket,
            clear_current_ticket,
            list_jira_projects,
            list_jira_boards,
            list_board_issues,
            has_stored_credentials,
            unlock_credentials,
            save_jira_credentials,
            logout_jira,
            get_public_ip,
            get_network_info,
            open_firewall_port,
            open_upnp_port,
            get_share_url,
            connect_relay,
            disconnect_relay,
            is_relay_connected,
            get_relay_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn create_room(
    state: tauri::State<'_, Arc<AppState>>,
    name: String,
) -> Result<room::Room, String> {
    Ok(state.create_room(name))
}

#[tauri::command]
async fn get_rooms(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<room::Room>, String> {
    Ok(state.get_rooms())
}

#[tauri::command]
async fn get_room(
    state: tauri::State<'_, Arc<AppState>>,
    room_id: String,
) -> Result<Option<room::Room>, String> {
    Ok(state.get_room(&room_id))
}

#[tauri::command]
async fn delete_room(state: tauri::State<'_, Arc<AppState>>, room_id: String) -> Result<bool, String> {
    Ok(state.delete_room(&room_id))
}

#[tauri::command]
async fn reveal_votes(state: tauri::State<'_, Arc<AppState>>, room_id: String) -> Result<(), String> {
    state.set_votes_revealed(&room_id, true);
    state.broadcast_room_update(&room_id).await;
    Ok(())
}

#[tauri::command]
async fn hide_votes(state: tauri::State<'_, Arc<AppState>>, room_id: String) -> Result<(), String> {
    state.set_votes_revealed(&room_id, false);
    state.broadcast_room_update(&room_id).await;
    Ok(())
}

#[tauri::command]
async fn reset_votes(state: tauri::State<'_, Arc<AppState>>, room_id: String) -> Result<(), String> {
    state.reset_votes(&room_id);
    state.broadcast_room_update(&room_id).await;
    Ok(())
}

#[tauri::command]
async fn get_server_url(state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    Ok(state.get_server_url())
}

#[tauri::command]
async fn get_share_url(state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    Ok(state.get_share_url())
}

#[tauri::command]
async fn kick_participant(
    state: tauri::State<'_, Arc<AppState>>,
    room_id: String,
    participant_id: String,
) -> Result<(), String> {
    state.remove_participant(&room_id, &participant_id);
    state.broadcast_room_update(&room_id).await;
    Ok(())
}

#[tauri::command]
async fn set_jira_config(
    state: tauri::State<'_, Arc<AppState>>,
    base_url: String,
    email: String,
    api_token: String,
) -> Result<(), String> {
    state.set_jira_config(base_url, email, api_token);
    Ok(())
}

#[tauri::command]
async fn has_jira_config(state: tauri::State<'_, Arc<AppState>>) -> Result<bool, String> {
    Ok(state.has_jira_config())
}

/// Jira API response structures
#[derive(Debug, Deserialize)]
struct JiraIssueResponse {
    key: String,
    fields: JiraFields,
}

#[derive(Debug, Deserialize)]
struct JiraFields {
    summary: String,
    description: Option<JiraDescriptionValue>,
    issuetype: Option<JiraIssueType>,
    status: Option<JiraStatus>,
}

/// Description can be either a plain string or ADF (Atlassian Document Format)
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum JiraDescriptionValue {
    PlainString(String),
    Adf(JiraDescription),
}

#[derive(Debug, Deserialize)]
struct JiraDescription {
    content: Option<Vec<JiraContentNode>>,
}

/// ADF content node - can contain text or nested content
#[derive(Debug, Deserialize)]
struct JiraContentNode {
    #[serde(rename = "type")]
    node_type: Option<String>,
    text: Option<String>,
    content: Option<Vec<JiraContentNode>>,
}

impl JiraContentNode {
    /// Recursively extract all text from this node and its children
    fn extract_text(&self) -> String {
        let mut result = String::new();
        
        // If this node has direct text, add it
        if let Some(ref text) = self.text {
            result.push_str(text);
        }
        
        // Recursively process child content
        if let Some(ref children) = self.content {
            for child in children {
                result.push_str(&child.extract_text());
            }
        }
        
        // Add newline after paragraph nodes
        if let Some(ref node_type) = self.node_type {
            if node_type == "paragraph" || node_type == "heading" {
                result.push('\n');
            }
        }
        
        result
    }
}

#[derive(Debug, Deserialize)]
struct JiraIssueType {
    name: String,
}

#[derive(Debug, Deserialize)]
struct JiraStatus {
    name: String,
}

#[tauri::command]
async fn fetch_jira_ticket(
    state: tauri::State<'_, Arc<AppState>>,
    room_id: String,
    ticket_key: String,
) -> Result<JiraTicket, String> {
    let config = state.get_jira_config();
    
    if config.base_url.is_empty() || config.email.is_empty() || config.api_token.is_empty() {
        return Err("Jira is not configured. Please set up Jira credentials first.".into());
    }

    let url = format!("{}/rest/api/3/issue/{}", config.base_url, ticket_key);
    let auth = format!("{}:{}", config.email, config.api_token);
    let auth_header = format!("Basic {}", general_purpose::STANDARD.encode(auth));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", auth_header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch ticket: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Jira API error ({}): {}", status, body));
    }

    let issue: JiraIssueResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Jira response: {}", e))?;

    // Extract full description text - handles both plain string and ADF format
    let description = issue.fields.description.and_then(|d| match d {
        JiraDescriptionValue::PlainString(s) => Some(s),
        JiraDescriptionValue::Adf(adf) => {
            adf.content.map(|contents| {
                contents.iter()
                    .map(|node| node.extract_text())
                    .collect::<String>()
                    .trim()
                    .to_string()
            }).filter(|s| !s.is_empty())
        }
    });

    let ticket = JiraTicket {
        key: issue.key.clone(),
        summary: issue.fields.summary,
        description,
        issue_type: issue.fields.issuetype.map(|t| t.name),
        status: issue.fields.status.map(|s| s.name),
        url: format!("{}/browse/{}", config.base_url, issue.key),
    };

    // Update the room with the ticket
    state.set_current_ticket(&room_id, Some(ticket.clone()));
    state.broadcast_room_update(&room_id).await;

    Ok(ticket)
}

#[tauri::command]
async fn clear_current_ticket(
    state: tauri::State<'_, Arc<AppState>>,
    room_id: String,
) -> Result<(), String> {
    state.set_current_ticket(&room_id, None);
    state.broadcast_room_update(&room_id).await;
    Ok(())
}

// ============ Jira Project/Board Browsing ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraProject {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct JiraProjectResponse {
    id: String,
    key: String,
    name: String,
}

#[tauri::command]
async fn list_jira_projects(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<JiraProject>, String> {
    let config = state.get_jira_config();
    
    if !state.has_jira_config() {
        return Err("Jira is not configured.".into());
    }

    let url = format!("{}/rest/api/3/project", config.base_url);
    let auth = format!("{}:{}", config.email, config.api_token);
    let auth_header = format!("Basic {}", general_purpose::STANDARD.encode(auth));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch projects: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Jira API error ({}): {}", status, body));
    }

    let projects: Vec<JiraProjectResponse> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse projects: {}", e))?;

    Ok(projects.into_iter().map(|p| JiraProject {
        id: p.id,
        key: p.key,
        name: p.name,
    }).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraBoard {
    pub id: i64,
    pub name: String,
    pub board_type: String,
}

#[derive(Debug, Deserialize)]
struct JiraBoardsResponse {
    values: Vec<JiraBoardValue>,
}

#[derive(Debug, Deserialize)]
struct JiraBoardValue {
    id: i64,
    name: String,
    #[serde(rename = "type")]
    board_type: String,
}

#[tauri::command]
async fn list_jira_boards(
    state: tauri::State<'_, Arc<AppState>>,
    project_key: String,
) -> Result<Vec<JiraBoard>, String> {
    let config = state.get_jira_config();
    
    if !state.has_jira_config() {
        return Err("Jira is not configured.".into());
    }

    let url = format!("{}/rest/agile/1.0/board?projectKeyOrId={}", config.base_url, project_key);
    let auth = format!("{}:{}", config.email, config.api_token);
    let auth_header = format!("Basic {}", general_purpose::STANDARD.encode(auth));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch boards: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Jira API error ({}): {}", status, body));
    }

    let boards: JiraBoardsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse boards: {}", e))?;

    Ok(boards.values.into_iter().map(|b| JiraBoard {
        id: b.id,
        name: b.name,
        board_type: b.board_type,
    }).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraIssueInfo {
    pub key: String,
    pub summary: String,
    pub issue_type: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraBoardIssuesResponse {
    issues: Vec<JiraIssueResponse>,
}

#[tauri::command]
async fn list_board_issues(
    state: tauri::State<'_, Arc<AppState>>,
    board_id: i64,
) -> Result<Vec<JiraIssueInfo>, String> {
    let config = state.get_jira_config();
    
    if !state.has_jira_config() {
        return Err("Jira is not configured.".into());
    }

    // Try backlog first, then fall back to board issues
    let url = format!("{}/rest/agile/1.0/board/{}/backlog?maxResults=50", config.base_url, board_id);
    let auth = format!("{}:{}", config.email, config.api_token);
    let auth_header = format!("Basic {}", general_purpose::STANDARD.encode(auth));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch issues: {}", e))?;

    if !response.status().is_success() {
        // Try board issues instead
        let url = format!("{}/rest/agile/1.0/board/{}/issue?maxResults=50", config.base_url, board_id);
        let response = client
            .get(&url)
            .header("Authorization", &auth_header)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch issues: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Jira API error ({}): {}", status, body));
        }

        let issues: JiraBoardIssuesResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse issues: {}", e))?;

        return Ok(issues.issues.into_iter().map(|i| JiraIssueInfo {
            key: i.key,
            summary: i.fields.summary,
            issue_type: i.fields.issuetype.map(|t| t.name),
            status: i.fields.status.map(|s| s.name),
        }).collect());
    }

    let issues: JiraBoardIssuesResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse issues: {}", e))?;

    Ok(issues.issues.into_iter().map(|i| JiraIssueInfo {
        key: i.key,
        summary: i.fields.summary,
        issue_type: i.fields.issuetype.map(|t| t.name),
        status: i.fields.status.map(|s| s.name),
    }).collect())
}

// ============ Credential Management ============

#[tauri::command]
async fn has_stored_credentials() -> Result<bool, String> {
    Ok(credentials::has_stored_credentials())
}

#[tauri::command]
async fn unlock_credentials(
    state: tauri::State<'_, Arc<AppState>>,
    password: String,
) -> Result<bool, String> {
    let creds = credentials::load_credentials(&password)?;
    state.set_jira_config(creds.base_url, creds.email, creds.api_token);
    Ok(true)
}

#[tauri::command]
async fn save_jira_credentials(
    state: tauri::State<'_, Arc<AppState>>,
    password: String,
    base_url: String,
    email: String,
    api_token: String,
) -> Result<(), String> {
    let creds = credentials::JiraCredentials {
        base_url: base_url.clone(),
        email: email.clone(),
        api_token: api_token.clone(),
    };
    
    credentials::save_credentials(&password, &creds)?;
    state.set_jira_config(base_url, email, api_token);
    Ok(())
}

#[tauri::command]
async fn logout_jira(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.set_jira_config(String::new(), String::new(), String::new());
    Ok(())
}

// ============ Network Commands ============

#[derive(Serialize)]
struct NetworkInfo {
    local_ip: String,
    public_ip: Option<String>,
    port: u16,
    local_url: String,
    public_url: Option<String>,
    firewall_open: bool,
}

#[tauri::command]
async fn get_public_ip() -> Result<String, String> {
    let client = reqwest::Client::new();
    
    // Try multiple services in case one is down
    let services = [
        "https://api.ipify.org",
        "https://icanhazip.com",
        "https://ifconfig.me/ip",
    ];
    
    for service in services {
        if let Ok(resp) = client.get(service).timeout(std::time::Duration::from_secs(5)).send().await {
            if let Ok(ip) = resp.text().await {
                let ip = ip.trim().to_string();
                if !ip.is_empty() {
                    return Ok(ip);
                }
            }
        }
    }
    
    Err("Could not determine public IP".to_string())
}

#[tauri::command]
async fn get_network_info(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<NetworkInfo, String> {
    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());
    
    let server_url = state.get_server_url();
    let port = server_url.split(':').last()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(3030);
    
    // Try to get public IP
    let public_ip = get_public_ip().await.ok();
    
    // Cache the public IP in state
    state.set_public_ip(public_ip.clone());
    
    // Check if firewall rule exists
    let firewall_open = check_firewall_rule(port);
    
    // Update firewall state
    state.set_firewall_open(firewall_open);
    
    let local_url = format!("http://{}:{}", local_ip, port);
    let public_url = public_ip.as_ref().map(|ip| format!("http://{}:{}", ip, port));
    
    Ok(NetworkInfo {
        local_ip,
        public_ip,
        port,
        local_url,
        public_url,
        firewall_open,
    })
}

fn check_firewall_rule(port: u16) -> bool {
    // Check if firewall rule exists using netsh
    let output = std::process::Command::new("netsh")
        .args(["advfirewall", "firewall", "show", "rule", "name=ScrumPoker"])
        .output();
    
    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains(&port.to_string())
        }
        Err(_) => false,
    }
}

#[tauri::command]
async fn open_upnp_port(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, String> {
    use igd_next::aio::tokio::search_gateway;
    use igd_next::PortMappingProtocol;
    use std::net::SocketAddrV4;
    
    let server_url = state.get_server_url();
    let port = server_url.split(':').last()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(3030);
    
    // Get local IP
    let local_ip = local_ip_address::local_ip()
        .map_err(|e| format!("Failed to get local IP: {}", e))?;
    
    let local_ip_v4 = match local_ip {
        std::net::IpAddr::V4(ip) => ip,
        std::net::IpAddr::V6(_) => return Err("IPv6 not supported for UPnP".to_string()),
    };
    
    // Search for UPnP gateway (router)
    tracing::info!("Searching for UPnP gateway...");
    let gateway = search_gateway(Default::default())
        .await
        .map_err(|e| format!("Could not find UPnP gateway. Your router may not support UPnP or it may be disabled. Error: {}", e))?;
    
    tracing::info!("Found gateway: {:?}", gateway);
    
    // Get external IP from router
    let external_ip = gateway.get_external_ip()
        .await
        .map_err(|e| format!("Failed to get external IP from router: {}", e))?;
    
    tracing::info!("External IP: {}", external_ip);
    
    // Remove any existing mapping first (ignore errors)
    let _ = gateway.remove_port(PortMappingProtocol::TCP, port).await;
    
    // Add port mapping
    let local_addr = SocketAddrV4::new(local_ip_v4, port);
    gateway.add_port(
        PortMappingProtocol::TCP,
        port,
        std::net::SocketAddr::V4(local_addr),
        3600, // 1 hour lease (will need refresh for longer sessions)
        "Scrum Poker",
    )
    .await
    .map_err(|e| format!("Failed to add UPnP port mapping: {}", e))?;
    
    tracing::info!("UPnP port {} mapped successfully", port);
    
    // Cache the public IP and mark as open
    state.set_public_ip(Some(external_ip.to_string()));
    state.set_firewall_open(true);
    
    Ok(format!("UPnP port {} opened successfully! External IP: {}", port, external_ip))
}

#[tauri::command]
async fn open_firewall_port(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let server_url = state.get_server_url();
    let port = server_url.split(':').last()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(3030);
    
    // Create a temporary batch file with the netsh commands
    let temp_dir = std::env::temp_dir();
    let batch_path = temp_dir.join("scrum_poker_firewall.bat");
    
    let batch_content = format!(
        r#"@echo off
netsh advfirewall firewall delete rule name="ScrumPoker" >nul 2>&1
netsh advfirewall firewall add rule name="ScrumPoker" dir=in action=allow protocol=TCP localport={}
exit /b %ERRORLEVEL%
"#,
        port
    );
    
    std::fs::write(&batch_path, &batch_content)
        .map_err(|e| format!("Failed to create batch file: {}", e))?;
    
    // Run the batch file as admin using PowerShell Start-Process with RunAs
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process -FilePath '{}' -Verb RunAs -Wait -WindowStyle Hidden",
                batch_path.display()
            )
        ])
        .output()
        .map_err(|e| format!("Failed to run command: {}", e))?;
    
    // Clean up the batch file
    let _ = std::fs::remove_file(&batch_path);
    
    if output.status.success() {
        // Give Windows a moment to update firewall state
        std::thread::sleep(std::time::Duration::from_millis(500));
        
        // Verify the rule was created
        if check_firewall_rule(port) {
            // Mark firewall as open in state
            state.set_firewall_open(true);
            
            // Also fetch and cache the public IP so share URL works
            if let Ok(public_ip) = get_public_ip().await {
                state.set_public_ip(Some(public_ip));
            }
            
            Ok(format!("Firewall rule created for port {}", port))
        } else {
            Err("Firewall rule may not have been created. Please run the app as administrator or accept the UAC prompt.".to_string())
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to create firewall rule. User may have cancelled UAC prompt. {}", stderr))
    }
}

// ============ Relay Commands ============

#[tauri::command]
async fn connect_relay(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, String> {
    // Check if already connected
    if state.is_relay_connected().await {
        return Ok("Already connected to relay".to_string());
    }
    
    let relay_client = relay::RelayClient::connect(None).await?;
    
    // Store the relay client in state
    state.set_relay_client(Some(relay_client.clone())).await;
    
    // Wait a moment for registration
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    let relay_url = relay_client.get_relay_url().await;
    Ok(format!("Connected to relay: {}", relay_url))
}

#[tauri::command]
async fn disconnect_relay(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.set_relay_client(None).await;
    Ok(())
}

#[tauri::command]
async fn is_relay_connected(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    Ok(state.is_relay_connected().await)
}

#[tauri::command]
async fn get_relay_url(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    if let Some(client) = state.get_relay_client().await {
        Ok(Some(client.get_relay_url().await))
    } else {
        Ok(None)
    }
}
