// The window, the device token in the Keychain and the browser for links. Requests go through the http plugin,
// hz:// links through deep-link; everything else is the web app.
use keyring::Entry;

const SERVICE: &str = "hz";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

// None when the Keychain holds no token for the hub's host; any other failure is said.
#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
    entry(&account)?.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Only http and https: the browser is not a launcher for anything else.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("not a web address: {url}"));
    }
    let status = std::process::Command::new("open").arg(&url).status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("open {url} exited with {status}"));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![keychain_get, keychain_set, keychain_delete, open_url])
        .run(tauri::generate_context!())
        .expect("hz desktop failed to start");
}
