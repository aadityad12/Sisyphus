//! Thin desktop layer: opens the window and runs the Python engine beside it.
//! Keep the logic in `engine/` (Python) and `app/src` (UI) so changes there need no Rust rebuild.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

const ENGINE_PORT: &str = "8765";

struct Engine(Mutex<Option<Child>>);

/// The repo's `engine/` directory, resolved at compile time. Good enough for local dev.
fn engine_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../engine")
}

/// Start the engine unless SISYPHUS_EXTERNAL_ENGINE is set; set it if you run
/// `uv run python -m sisyphus_engine --reload` yourself for hot reload.
fn spawn_engine() -> Option<Child> {
    if std::env::var_os("SISYPHUS_EXTERNAL_ENGINE").is_some() {
        return None;
    }
    let dir = engine_dir();
    // Run the venv's Python directly: killing a `uv run` wrapper on Windows can orphan its child.
    let python = if cfg!(windows) {
        dir.join(".venv/Scripts/python.exe")
    } else {
        dir.join(".venv/bin/python")
    };
    if !python.exists() {
        eprintln!(
            "[sisyphus] {} not found. Run `uv sync` in engine/ first.",
            python.display()
        );
        return None;
    }
    match Command::new(python)
        .args(["-m", "sisyphus_engine", "--port", ENGINE_PORT])
        .current_dir(&dir)
        .spawn()
    {
        Ok(child) => Some(child),
        Err(err) => {
            eprintln!("[sisyphus] failed to start engine: {err}");
            None
        }
    }
}

#[tauri::command]
fn engine_url() -> String {
    format!("http://127.0.0.1:{ENGINE_PORT}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            *app.state::<Engine>().0.lock().unwrap() = spawn_engine();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_url])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Engine>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
