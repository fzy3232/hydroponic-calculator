//! 水培营养液配方计算器 · Tauri 外壳。
//!
//! 这里刻意保持最小：全部业务逻辑都在前端（`../src` 的纯 ESM 代码），
//! Rust 侧只做两件事——
//!   1. 创建窗口并加载 `frontendDist`（`../dist/index.html`）
//!   2. 注册「另存为」所需的 dialog / fs 插件
//!
//! 为什么需要这两个插件：Tauri（WebView2）里 `a[download]` 形式的 Blob 下载
//! **不可靠**，导出 CSV 必须走系统另存为对话框 + 真实写盘。

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let outcome = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 实测发现：release 版窗口创建后 `visible` 为 false（进程在跑、页面已渲染，
            // 但用户看不到窗口）。这里显式显示并聚焦，避免"双击没反应"这种最糟的失败形态。
            // 配置里的 `visible: true` 与这里是双保险。
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
                window.set_focus()?;
            } else {
                // 窗口缺失不 panic：交由上层统一提示后退出
                return Err("未找到主窗口（label = main）".into());
            }
            Ok(())
        })
        .run(tauri::generate_context!());

    // 不使用 unwrap / expect：启动失败时给出**用户看得见**的提示，再以非零码退出。
    // release 构建是 windows_subsystem = "windows"，没有控制台，
    // 如果在这里 panic，用户只会看到"双击没反应"，连错误信息都拿不到。
    if let Err(error) = outcome {
        report_startup_failure(&error.to_string());
        std::process::exit(1);
    }
}

/// 用系统消息框报告启动失败（Windows：用户可见）。
#[cfg(target_os = "windows")]
fn report_startup_failure(message: &str) {
    let _ = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("水培营养液配方计算器")
        .set_description(&format!("启动失败：{message}"))
        .show();
}

/// 非 Windows 平台退化为 stderr 输出（避免引入平台无关的 GUI 依赖）。
#[cfg(not(target_os = "windows"))]
fn report_startup_failure(message: &str) {
    eprintln!("启动失败：{message}");
}
