use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use base64::{Engine as _, engine::general_purpose};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const CREDENTIALS_FILE: &str = "jira_credentials.enc";
const SALT_FILE: &str = "jira_salt.key";

/// Encrypted credentials stored on disk
#[derive(Debug, Serialize, Deserialize)]
struct EncryptedCredentials {
    nonce: String,       // Base64 encoded
    ciphertext: String,  // Base64 encoded
}

/// Plain credentials before encryption
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraCredentials {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
}

/// Get the app data directory
fn get_data_dir() -> Result<PathBuf, String> {
    directories::ProjectDirs::from("com", "scrumpoker", "ScrumPoker")
        .map(|dirs| dirs.data_dir().to_path_buf())
        .ok_or_else(|| "Could not determine data directory".to_string())
}

/// Derive an encryption key from password using Argon2
fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let argon2 = Argon2::default();
    let mut key = [0u8; 32];
    
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;
    
    Ok(key)
}

/// Get or create a salt for key derivation
fn get_or_create_salt() -> Result<Vec<u8>, String> {
    let data_dir = get_data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    
    let salt_path = data_dir.join(SALT_FILE);
    
    if salt_path.exists() {
        fs::read(&salt_path).map_err(|e| format!("Failed to read salt: {}", e))
    } else {
        let mut salt = vec![0u8; 32];
        OsRng.fill_bytes(&mut salt);
        fs::write(&salt_path, &salt).map_err(|e| format!("Failed to write salt: {}", e))?;
        Ok(salt)
    }
}

/// Check if credentials are stored
pub fn has_stored_credentials() -> bool {
    if let Ok(data_dir) = get_data_dir() {
        data_dir.join(CREDENTIALS_FILE).exists()
    } else {
        false
    }
}

/// Save encrypted credentials
pub fn save_credentials(password: &str, credentials: &JiraCredentials) -> Result<(), String> {
    let data_dir = get_data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    
    let salt = get_or_create_salt()?;
    let key = derive_key(password, &salt)?;
    
    // Serialize credentials to JSON
    let plain_text = serde_json::to_string(credentials)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;
    
    // Generate random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    // Encrypt
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    
    let ciphertext = cipher
        .encrypt(nonce, plain_text.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;
    
    // Save to file
    let encrypted = EncryptedCredentials {
        nonce: general_purpose::STANDARD.encode(nonce_bytes),
        ciphertext: general_purpose::STANDARD.encode(ciphertext),
    };
    
    let json = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize encrypted data: {}", e))?;
    
    fs::write(data_dir.join(CREDENTIALS_FILE), json)
        .map_err(|e| format!("Failed to write credentials file: {}", e))?;
    
    Ok(())
}

/// Load and decrypt credentials
pub fn load_credentials(password: &str) -> Result<JiraCredentials, String> {
    let data_dir = get_data_dir()?;
    let cred_path = data_dir.join(CREDENTIALS_FILE);
    
    if !cred_path.exists() {
        return Err("No stored credentials found".to_string());
    }
    
    let salt = get_or_create_salt()?;
    let key = derive_key(password, &salt)?;
    
    // Read encrypted file
    let json = fs::read_to_string(&cred_path)
        .map_err(|e| format!("Failed to read credentials file: {}", e))?;
    
    let encrypted: EncryptedCredentials = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse credentials file: {}", e))?;
    
    // Decode base64
    let nonce_bytes = general_purpose::STANDARD
        .decode(&encrypted.nonce)
        .map_err(|e| format!("Failed to decode nonce: {}", e))?;
    
    let ciphertext = general_purpose::STANDARD
        .decode(&encrypted.ciphertext)
        .map_err(|e| format!("Failed to decode ciphertext: {}", e))?;
    
    // Decrypt
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;
    
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plain_text = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Invalid password or corrupted credentials".to_string())?;
    
    // Parse JSON
    let credentials: JiraCredentials = serde_json::from_slice(&plain_text)
        .map_err(|e| format!("Failed to parse decrypted credentials: {}", e))?;
    
    Ok(credentials)
}

/// Delete stored credentials
pub fn delete_credentials() -> Result<(), String> {
    let data_dir = get_data_dir()?;
    let cred_path = data_dir.join(CREDENTIALS_FILE);
    
    if cred_path.exists() {
        fs::remove_file(&cred_path)
            .map_err(|e| format!("Failed to delete credentials: {}", e))?;
    }
    
    Ok(())
}
