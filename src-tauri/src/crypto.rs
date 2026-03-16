use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::rand_core::OsRng, Argon2, Params};
use rand::RngCore;
use zeroize::{Zeroize, Zeroizing};

const SALT_LEN: usize = 32;

/// Key derivation function using Argon2
/// Derive a 32-byte key from a password and salt
fn derive_key(password: &Zeroizing<String>, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let mut key = [0u8; 32];

    // Mobile-optimized Argon2id parameters (m=16MB, t=1, p=1)
    // Goal: Target ~10-20ms computation time to ensure fluid UX on constrained mobile CPUs.
    let params = Params::new(
        16384,    // 16 MB memory cost
        1,        // 1 iteration
        1,        // 1 degree of parallelism
        Some(32), // Key length
    )
    .map_err(|e| format!("Invalid Argon2 params: {}", e))?;

    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);

    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;
    Ok(Zeroizing::new(key))
}

/// Encrypt data with AES-256-GCM.
/// Input: plaintext, password
/// Output: salt (32 bytes) + nonce (12 bytes) + ciphertext
pub fn encrypt_v1(
    plaintext: &Zeroizing<String>,
    password: &Zeroizing<String>,
) -> Result<Vec<u8>, String> {
    // 1. Generate random salt
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    // 2. Derive key
    let key = derive_key(password, &salt)?;

    // 3. Setup cipher
    let cipher = Aes256Gcm::new(key.as_ref().into());

    // 4. Generate random nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // 5. Encrypt
    let mut ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // 6. Combine salt + nonce + ciphertext
    let mut result = Vec::with_capacity(salt.len() + nonce_bytes.len() + ciphertext.len());
    result.extend_from_slice(&salt);
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    // Explicitly zeroize temporary ciphertext vector before dropping
    ciphertext.zeroize();

    Ok(result)
}

/// Decrypt data with AES-256-GCM.
/// Input: combined bytes (salt + nonce + ciphertext), password
/// Output: Decrypted plaintext string
pub fn decrypt_v1(data: &[u8], password: &Zeroizing<String>) -> Result<Zeroizing<String>, String> {
    if data.len() < SALT_LEN + 12 {
        return Err("Data too short".into());
    }

    // 1. Extract salt, nonce, ciphertext
    let (salt, rest) = data.split_at(SALT_LEN);
    let (nonce_bytes, ciphertext) = rest.split_at(12);

    // 2. Derive key using extracted salt
    let key = derive_key(password, salt)?;

    // 3. Setup cipher
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new(key.as_ref().into());

    // 4. Decrypt
    let mut plaintext_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed: Incorrect password or corrupted data".to_string())?;

    // 5. Convert to String
    let plaintext = String::from_utf8(plaintext_bytes.clone())
        .map_err(|_| "Invalid UTF-8 sequence".to_string())?;

    // Explicitly zeroize plaintext bytes before returning String
    plaintext_bytes.zeroize();

    Ok(Zeroizing::new(plaintext))
}
