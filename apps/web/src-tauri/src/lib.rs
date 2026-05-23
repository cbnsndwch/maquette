// Musicologia desktop entry point. The frontend is the same Vite + Three.js app
// in ../src; Tauri just hosts it in the system webview. WebGL works across
// platforms — if you load external assets, resolve them through the frontend's
// `assetUrl` helper backed by Tauri's `convertFileSrc` (a raw fetch of a local
// path fails in the webview).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Musicologia");
}
