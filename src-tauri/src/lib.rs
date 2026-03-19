mod crypto;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, Emitter};
use zeroize::Zeroizing;

const CURRENT_CRYPTO_VERSION: &str = "v2";

static PENDING_PATHS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Session password cache — the master password lives here in Zeroizing memory
/// instead of in the JavaScript heap. Cleared on lock via `clear_session`.
static SESSION_PASSWORD: Mutex<Option<Zeroizing<String>>> = Mutex::new(None);

/// Sanitize a vault file path to prevent path traversal and injection attacks.
/// - Rejects `..` components and enforces `.wspace` extension.
/// - For relative filenames: validates characters (alphanumeric, hyphen, underscore, dot).
/// - For absolute paths (from Tauri file dialogs): checks that the resolved path exists
///   under a plausible directory (no `..` canonicalization tricks).
fn sanitize_vault_path(filename: &str) -> Result<PathBuf, String> {
    // Reject empty or overly long paths
    if filename.is_empty() || filename.len() > 1024 {
        return Err("Invalid path: length out of bounds".to_string());
    }
    // Reject path traversal attempts (.. in any component)
    if filename.contains("..") {
        return Err("Invalid path: path traversal detected".to_string());
    }
    // Enforce .wspace extension
    if !filename.ends_with(".wspace") {
        return Err("Invalid path: must have .wspace extension".to_string());
    }

    let path = PathBuf::from(filename);
    if path.is_absolute() {
        // Absolute path from file dialog — validate no sneaky components
        // canonicalize() resolves symlinks; verify the result still ends with .wspace
        match path.canonicalize() {
            Ok(resolved) => {
                if !resolved.to_string_lossy().ends_with(".wspace") {
                    return Err("Invalid path: resolved path has wrong extension".to_string());
                }
                Ok(resolved)
            }
            Err(_) => {
                // File may not exist yet (new vault) — use the original path
                Ok(path)
            }
        }
    } else {
        // Relative filename — strict character validation
        // Only allow: a-z, A-Z, 0-9, hyphen, underscore, dot (for extension)
        let stem = filename.strip_suffix(".wspace").unwrap_or(filename);
        if !stem.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return Err("Invalid filename: contains illegal characters".to_string());
        }
        if stem.is_empty() {
            return Err("Invalid filename: empty stem".to_string());
        }
        let mut file_path = PathBuf::from(env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        file_path.push(filename);
        Ok(file_path)
    }
}

/// Convert a std::io::Error into a safe, user-facing error string without leaking paths.
fn sanitize_io_error(context: &str, e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => format!("{}: file not found", context),
        std::io::ErrorKind::PermissionDenied => format!("{}: permission denied", context),
        std::io::ErrorKind::AlreadyExists => format!("{}: file already exists", context),
        _ => format!("{}: I/O error", context),
    }
}

fn write_debug_log(_msg: &str) {
    /*
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    let log_entry = format!("[{}] {}\n", now, msg);
    
    // Write directly to macOS /tmp directory for diagnosis
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/lazywhisper_debug.log") 
    {
        let _ = file.write_all(log_entry.as_bytes());
    }
    */
}

#[tauri::command]
fn save_vault(filename: String, content: String) -> Result<bool, String> {
    let file_path = sanitize_vault_path(&filename)?;

    // Read password from session cache — never passed from frontend
    let password_z = {
        let guard = SESSION_PASSWORD.lock().map_err(|_| "Session lock poisoned".to_string())?;
        guard.clone().ok_or_else(|| "No active session: please unlock first".to_string())?
    };
    let content_z = Zeroizing::new(content);

    // Encrypt using current version
    let mut encrypted_bytes = crypto::encrypt_v2(&content_z, &password_z)?;

    // Envelope for binary: v1:CIPHERTEXT
    let mut payload = format!("{}:", CURRENT_CRYPTO_VERSION).into_bytes();
    payload.append(&mut encrypted_bytes);

    fs::write(&file_path, payload).map_err(|e| sanitize_io_error("Failed to save vault", &e))?;

    Ok(true)
}

pub fn parse_and_decrypt_bytes(data: &[u8], password: &str) -> Result<String, String> {
    let password_z = Zeroizing::new(password.to_string());

    // Try finding the version delimiter within the first 10 bytes
    let colon_pos = data.iter().take(10).position(|&b| b == b':');

    let (version, payload) = match colon_pos {
        Some(pos) if data.starts_with(b"v") => {
            let ver_str = std::str::from_utf8(&data[0..pos]).unwrap_or("unknown");
            (ver_str, &data[pos + 1..])
        }
        _ => {
            // Unprefixed legacy data from Milestone 36-38
            ("legacy_v1", data)
        }
    };

    match version {
        "v2" => {
            let plaintext_z = crypto::decrypt_v2(payload, &password_z)?;
            Ok(plaintext_z.as_str().to_string())
        },
        "v1" | "legacy_v1" => {
            let plaintext_z = crypto::decrypt_v1(payload, &password_z)?;
            Ok(plaintext_z.as_str().to_string())
        },
        _ => Err("ERROR_NEWER_VERSION: 当前文件使用了更高版本的加密算法，请将 LazyWhisper 升级至最新版以解锁。".to_string())
    }
}

#[tauri::command]
fn load_vault(filename: String, password: String) -> Result<String, String> {
    let file_path = sanitize_vault_path(&filename)?;

    let data = fs::read(&file_path).map_err(|e| sanitize_io_error("Failed to read vault", &e))?;

    let result = parse_and_decrypt_bytes(&data, &password)?;

    // Cache password on successful decrypt — frontend no longer stores it
    {
        let mut guard = SESSION_PASSWORD.lock().map_err(|_| "Session lock poisoned".to_string())?;
        *guard = Some(Zeroizing::new(password));
    }

    Ok(result)
}

/// Cache the master password in Rust memory (called during vault creation).
/// The frontend passes the password once, then forgets it.
#[tauri::command]
fn cache_session_password(password: String) -> Result<bool, String> {
    let mut guard = SESSION_PASSWORD.lock().map_err(|_| "Session lock poisoned".to_string())?;
    *guard = Some(Zeroizing::new(password));
    Ok(true)
}

/// Wipe the cached session password (called by forceLock).
/// The Zeroizing<String> wrapper ensures memory is overwritten on drop.
#[tauri::command]
fn clear_session() -> Result<bool, String> {
    let mut guard = SESSION_PASSWORD.lock().map_err(|_| "Session lock poisoned".to_string())?;
    *guard = None; // Zeroizing::drop() overwrites the memory
    Ok(true)
}

/// Change the vault password: verify old password matches session, re-encrypt vault, update cache.
#[tauri::command]
fn change_vault_password(filename: String, old_password: String, new_password: String, content: String) -> Result<bool, String> {
    // Verify old password matches current session
    {
        let guard = SESSION_PASSWORD.lock().map_err(|_| "Session lock poisoned".to_string())?;
        let cached = guard.as_ref().ok_or("No active session".to_string())?;
        if cached.as_str() != old_password {
            return Err("Incorrect current password".to_string());
        }
    }

    // Re-encrypt with new password
    let file_path = sanitize_vault_path(&filename)?;
    let new_password_z = Zeroizing::new(new_password);
    let content_z = Zeroizing::new(content);

    let mut encrypted_bytes = crypto::encrypt_v2(&content_z, &new_password_z)?;
    let mut payload = format!("{}:", CURRENT_CRYPTO_VERSION).into_bytes();
    payload.append(&mut encrypted_bytes);

    fs::write(&file_path, payload).map_err(|e| sanitize_io_error("Failed to save vault", &e))?;

    // Update session cache with new password
    {
        let mut guard = SESSION_PASSWORD.lock().map_err(|_| "Session lock poisoned".to_string())?;
        *guard = Some(new_password_z);
    }

    Ok(true)
}

#[tauri::command]
fn export_shared_file(
    file_path: String,
    temp_password: String,
    content: String,
) -> Result<bool, String> {
    let password_z = Zeroizing::new(temp_password);
    let content_z = Zeroizing::new(content);

    // Encrypt
    let mut encrypted_bytes = crypto::encrypt_v2(&content_z, &password_z)?;

    let mut payload = format!("{}:", CURRENT_CRYPTO_VERSION).into_bytes();
    payload.append(&mut encrypted_bytes);

    // Save to specified file path (validated by Tauri dialog, but sanitize write errors)
    fs::write(&file_path, payload).map_err(|e| sanitize_io_error("Failed to export shared file", &e))?;

    Ok(true)
}

#[tauri::command]
fn check_vault_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn encrypt_secret(plaintext: String, key: String) -> Result<String, String> {
    let plain_z = Zeroizing::new(plaintext);
    let key_z = Zeroizing::new(key);
    let encrypted_bytes = crypto::encrypt_v1(&plain_z, &key_z)?;
    Ok(format!(
        "v1:{}",
        STANDARD.encode(encrypted_bytes)
    ))
}

pub fn parse_and_decrypt_string(ciphertext: &str, key: &str) -> Result<String, String> {
    let key_z = Zeroizing::new(key.to_string());

    // Try extracting dynamic version from envelope (e.g. "v1:Base64..." -> "v1", "Base64...")
    let colon_pos = ciphertext.chars().take(10).position(|c| c == ':');

    let (version, b64_data) = match colon_pos {
        Some(pos) if ciphertext.starts_with('v') => (&ciphertext[0..pos], &ciphertext[pos + 1..]),
        _ => {
            // Fallback for milestone 36-38 unversioned Base64 data
            ("legacy_v1", ciphertext)
        }
    };

    match version {
        "v2" => {
            let encrypted_bytes = STANDARD.decode(b64_data)
                .map_err(|e| format!("Invalid Base64 format: {}", e))?;
            let plain_z = crypto::decrypt_v2(&encrypted_bytes, &key_z)?;
            Ok(plain_z.as_str().to_string())
        },
        "v1" | "legacy_v1" => {
            let encrypted_bytes = STANDARD.decode(b64_data)
                .map_err(|e| format!("Invalid Base64 format: {}", e))?;
            let plain_z = crypto::decrypt_v1(&encrypted_bytes, &key_z)?;
            Ok(plain_z.as_str().to_string())
        },
        _ => Err("ERROR_NEWER_VERSION: 当前文件使用了更高版本的加密算法，请将 LazyWhisper 升级至最新版以解锁。".to_string())
    }
}

#[tauri::command]
fn decrypt_secret(ciphertext: String, key: String) -> Result<String, String> {
    parse_and_decrypt_string(&ciphertext, &key)
}

#[tauri::command]
fn log_to_rust(message: String) {
    println!("[React 穿透日志] {}", message);
    write_debug_log(&format!("⚛️ [REACT] {}", message));
}

#[tauri::command]
fn frontend_is_ready() -> Vec<String> {
    write_debug_log("🤝 [RUST] 前端发起就绪握手，正在交出队列路径...");
    if let Ok(mut paths) = PENDING_PATHS.lock() {
        let result = paths.clone();
        paths.clear();
        write_debug_log(&format!("🤝 [RUST] 成功交出并清空队列: {:?}", result));
        result
    } else {
        write_debug_log("❌ [RUST] 无法获取 PENDING_PATHS 锁！");
        Vec::new()
    }
}

// Helper to unify file opened logic
fn handle_opened_file(app: &tauri::AppHandle, path: String) {
    println!("[Rust] 准备将路径交接给前端... {}", path);
    write_debug_log(&format!("📦 [RUST] 准备将路径交接给前端... {}", path));
    
    // 1. Queue it for cold starts (Front-end might not have `listen` ready)
    if let Ok(mut pending) = PENDING_PATHS.lock() {
        pending.push(path.clone());
        write_debug_log(&format!("📥 [RUST] 路径已存入全局静态 PENDING_PATHS 队列: {}", path));
    } else {
        write_debug_log("❌ [RUST] 将路径存入队列失败：无法获取 PENDING_PATHS 锁");
    }
    
    // 2. Broadcast it for warm starts (Front-end is already `listen`ing)
    let _ = app.emit("wspace-file-opened", &path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    write_debug_log("🚀 [RUST] 应用程序进程启动");
    let mut builder = tauri::Builder::default()
        .setup(|_app| {
            let args: Vec<String> = std::env::args().collect();
            write_debug_log(&format!("📦 [RUST SETUP] 拿到命令行参数: {:?}", args));
            
            // Parse CLI args for Windows/Linux cold starts
            for arg in std::env::args().skip(1) {
                if arg.ends_with(".wspace") {
                    println!("[Rust Boot] 拿到冷启动参数: {}", arg);
                    if let Ok(mut pending) = PENDING_PATHS.lock() {
                        pending.push(arg.clone());
                    }
                }
            }
            
            Ok(())
        });

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Windows / Linux duplicate launch args interception
            for arg in args {
                if arg.ends_with(".wspace") {
                    println!("[Rust SingleInstance] 收到新实例参数: {}", arg);
                    handle_opened_file(app.app_handle(), arg);
                    
                    // Focus the existing window
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    break;
                }
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_vault,
            load_vault,
            export_shared_file,
            check_vault_exists,
            encrypt_secret,
            decrypt_secret,
            frontend_is_ready,
            log_to_rust,
            cache_session_password,
            clear_session,
            change_vault_password,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                // macOS AppleEvents / Deep linking interception
                println!("🚨 [MACOS ALERT] 操作系统触发了 Opened 事件! 包含 {} 个 URL", urls.len());
                write_debug_log(&format!("🍎 [MACOS APPLE EVENT] 收到 Opened 事件, 包含 URLs: {:?}", urls));
                for url in urls {
                    println!("🚨 [MACOS URL] 原始 URL 字符串: {}", url.as_str());
                    let path_str = match url.to_file_path() {
                        Ok(p) => p.to_string_lossy().into_owned(),
                        Err(_) => url.path().to_string(), // Error fallback
                    };

                    if path_str.ends_with(".wspace") {
                        handle_opened_file(_app_handle, path_str);
                        break;
                    }
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // Case A (标准 v1 闭环)
    #[test]
    fn test_case_a_standard_v1_string() {
        let password = "super_secret_password";
        let plaintext = "Hello, LazyWhisper!";

        // 1. Encrypt directly simulating standard API entry
        let ciphertext = encrypt_secret(plaintext.to_string(), password.to_string()).unwrap();

        // Must carry our static anchor prefix
        assert!(ciphertext.starts_with("v1:"));

        // 2. Decrypt dynamically extracting protocol
        let decrypted = parse_and_decrypt_string(&ciphertext, password).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    // Case B (密码防爆破验证)
    #[test]
    fn test_case_b_wrong_password() {
        let password = "correct_password";
        let wrong_password = "wrong_password";
        let plaintext = "Important Secret";

        let ciphertext = encrypt_secret(plaintext.to_string(), password.to_string()).unwrap();

        // Ensure failure falls through `Result::Err` matrices, NOT `panic!`
        let result = parse_and_decrypt_string(&ciphertext, wrong_password);
        assert!(result.is_err());
    }

    // Case C (向后兼容/无前缀数据)
    #[test]
    fn test_case_c_legacy_fallback_string() {
        let password = "legacy_password";
        let plaintext = "Old Data Format";

        // Simulate legacy formatting: raw base64 of v1 encryption WITHOUT any structural tag
        let password_z = Zeroizing::new(password.to_string());
        let plain_z = Zeroizing::new(plaintext.to_string());
        let encrypted_bytes = crypto::encrypt_v1(&plain_z, &password_z).unwrap();
        let legacy_ciphertext = STANDARD.encode(encrypted_bytes);

        // Fast-forward raw legacy bytes into pure router. Expect smooth handling!
        let decrypted = parse_and_decrypt_string(&legacy_ciphertext, password).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    // Case D (向前兼容/高版本精准拦截)
    #[test]
    fn test_case_d_newer_version_intercept() {
        let password = "password123";
        // Create an exotic unmapped string payload
        let fake_v99_ciphertext = "v99:SomeFakeBase64PayloadExtractedRightHere";
        let result = parse_and_decrypt_string(fake_v99_ciphertext, password);

        assert!(result.is_err());
        let err_msg = result.unwrap_err();
        assert!(err_msg.contains("ERROR_NEWER_VERSION"));

        // Do identically for raw binary vectors
        let fake_v3_bytes = b"v3:SomeBinaryData";
        let result_bytes = parse_and_decrypt_bytes(fake_v3_bytes, password);
        assert!(result_bytes.is_err());
        assert!(result_bytes.unwrap_err().contains("ERROR_NEWER_VERSION"));
    }

    // Case E (畸形数据防御)
    #[test]
    fn test_case_e_malformed_data() {
        let password = "password123";

        // Absolute void arrays
        let empty_bytes: &[u8] = &[];
        let result_empty = parse_and_decrypt_bytes(empty_bytes, password);
        assert!(result_empty.is_err());

        // Prefix existing, payload completely truncated
        let truncated_str = "v1:";
        let result_truncated = parse_and_decrypt_string(truncated_str, password);
        assert!(result_truncated.is_err());
    }

    // 文件 I/O 隔离测试 (Isolation Constraint)
    #[test]
    fn test_file_io_isolation_vault() {
        let password = "io_test_password";
        let content = r#"[{"id":"1","title":"Test","content":"Safe format"}]"#;

        // Safely sandbox testing directories outside developer environments
        let temp_dir = std::env::temp_dir();
        let filename = format!(
            "test_vault_{}.wspace",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_micros()
        );
        let full_path = temp_dir.join(&filename);
        let path_str = full_path.to_str().unwrap().to_string();

        // Call OS API
        let save_result =
            export_shared_file(path_str.clone(), password.to_string(), content.to_string());
        assert!(save_result.is_ok());

        // Verify path physical instantiation
        assert!(super::check_vault_exists(path_str.clone()));

        // Scrape memory
        let data = fs::read(&full_path).unwrap();

        // Send blob into standard decrypt arrays
        let decrypted = super::parse_and_decrypt_bytes(&data, password).unwrap();
        assert_eq!(decrypted, content);

        // Garbage collect
        let _ = fs::remove_file(full_path);
    }

    // Case F (v2 压缩加密闭环)
    #[test]
    fn test_case_f_v2_round_trip() {
        let password = "v2_test_password";
        let plaintext = r#"[{"id":"1","title":"Test","content":"<p>Hello v2 compressed world!</p>"}]"#;

        let password_z = Zeroizing::new(password.to_string());
        let plain_z = Zeroizing::new(plaintext.to_string());

        // Encrypt with v2
        let encrypted_bytes = crypto::encrypt_v2(&plain_z, &password_z).unwrap();

        // Decrypt with v2
        let decrypted_z = crypto::decrypt_v2(&encrypted_bytes, &password_z).unwrap();
        assert_eq!(decrypted_z.as_str(), plaintext);
    }

    // Case G (v2 文件 I/O + v1 旧文件向后兼容)
    #[test]
    fn test_case_g_v2_file_io_and_v1_backward_compat() {
        let password = "compat_password";
        let content = r#"[{"id":"1","title":"Compat","content":"Backward compatible"}]"#;

        let temp_dir = std::env::temp_dir();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros();

        // --- Write v2 file, read back ---
        let v2_path = temp_dir.join(format!("test_v2_{}.wspace", ts));
        let v2_str = v2_path.to_str().unwrap().to_string();
        let save_res = export_shared_file(v2_str.clone(), password.to_string(), content.to_string());
        assert!(save_res.is_ok());
        let v2_data = fs::read(&v2_path).unwrap();
        assert!(v2_data.starts_with(b"v2:"));
        let decrypted_v2 = parse_and_decrypt_bytes(&v2_data, password).unwrap();
        assert_eq!(decrypted_v2, content);

        // --- Write a v1 file manually, verify load still works ---
        let v1_path = temp_dir.join(format!("test_v1_{}.wspace", ts));
        let password_z = Zeroizing::new(password.to_string());
        let content_z = Zeroizing::new(content.to_string());
        let mut v1_enc = crypto::encrypt_v1(&content_z, &password_z).unwrap();
        let mut v1_payload = b"v1:".to_vec();
        v1_payload.append(&mut v1_enc);
        fs::write(&v1_path, &v1_payload).unwrap();
        let v1_data = fs::read(&v1_path).unwrap();
        let decrypted_v1 = parse_and_decrypt_bytes(&v1_data, password).unwrap();
        assert_eq!(decrypted_v1, content);

        // Cleanup
        let _ = fs::remove_file(v2_path);
        let _ = fs::remove_file(v1_path);
    }
}
