mod config;
mod db;
mod handlers;
mod models;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
};
use std::net::SocketAddr;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use config::Config;
use db::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    // RUST_LOG=loza_server=debug,tower_http=debug для более подробного вывода
    // (по умолчанию — info, этого достаточно чтобы видеть каждый запрос/ответ).
    tracing_subscriber::fmt()
        .with_ansi(true)
        .with_target(true)
        .with_thread_ids(false)
        .with_level(true)
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "invalid startup configuration");
            std::process::exit(1);
        }
    };
    let addr = format!("0.0.0.0:{}", config.port);

    if let Err(error) = db::storage_fs::ensure_storage_layout() {
        tracing::error!(error = %error, "storage layout initialization failed");
        std::process::exit(1);
    }

    let pool = match db::repository::connect_and_migrate(&config.database_url).await {
        Ok(pool) => pool,
        Err(error) => {
            tracing::error!(error = %error, "database initialization failed");
            std::process::exit(1);
        }
    };
    if let Err(error) = handlers::auth::bootstrap_admin(&pool).await {
        tracing::error!(%error, "bootstrap administrator initialization failed");
        std::process::exit(1);
    }
    let session_cleanup_pool = pool.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(error) = db::repository::delete_expired_sessions(
                &session_cleanup_pool,
                handlers::auth::now_secs(),
            )
            .await
            {
                tracing::error!(%error, "expired session cleanup failed");
            }
        }
    });
    let state = AppState::new(pool, config);

    // Реконсиляция «БД ⇄ диск» — стартует в фоне, не блокируя сервер.
    let reconcile_pool = state.pool.clone();
    tokio::spawn(async move {
        db::consistency::reconcile_storage(&reconcile_pool).await;
    });

    let app = Router::new()
        .route("/health", get(handlers::auth::health))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/me", get(handlers::auth::me))
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/refresh", post(handlers::auth::refresh))
        .route("/status", get(handlers::status::get_status))
        .route("/ws/status", get(handlers::status::ws_status))
        .route("/ws/app", get(handlers::ws::ws_app))
        .route(
            "/calendar/events",
            get(handlers::calendar::get_events).post(handlers::calendar::create_event),
        )
        .route(
            "/calendar/events/:id",
            put(handlers::calendar::update_event).delete(handlers::calendar::delete_event),
        )
        // File API — HTTP (не WebSocket) с поддержкой потоковой передачи.
        // 500 MB лимит тела для файловых операций (загрузка файлов).
        // multipart уже стримится на диск по чанкам, лимит только для
        // защиты от злоупотреблений.
        .nest(
            "/files",
            Router::new()
                .route("/list", get(handlers::files::list_files))
                .route("/search", get(handlers::files::search_files))
                .route("/info", get(handlers::files::file_info))
                .route("/upload", post(handlers::files::upload_file))
                .route("/download", get(handlers::files::download_file))
                .route("/view", get(handlers::files::view_file))
                .route("/delete", delete(handlers::files::delete_file))
                .route("/rename", post(handlers::files::rename_file))
                .route("/move", post(handlers::files::move_file))
                .route("/copy", post(handlers::files::copy_file))
                .route("/batch", post(handlers::files::batch_files))
                .route("/mkdir", post(handlers::files::create_dir))
                // Управление share-ссылками (auth).
                .route("/share", post(handlers::shares::create_share))
                .route("/shares", get(handlers::shares::list_shares))
                .route("/share/revoke", delete(handlers::shares::revoke_share))
                .layer(DefaultBodyLimit::max(500 * 1024 * 1024)),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(TraceLayer::new_for_http());

    // Публичные share-ссылки. При наличии собранного share-viewer-web
    // сервер раздаёт SPA + password-API; без него — legacy: `/share/:token`
    // отдаёт тело файла inline. В обоих режимах `/share` (без токена) не
    // имеет маршрута и отдаёт 404 — индекс ссылок никогда не экспонируется.
    let app = match state.config.share_web_dir.as_ref() {
        Some(web_dir) => app
            .route("/share/:token", get(handlers::shares::share_page))
            .route(
                "/share/api/:token/meta",
                get(handlers::shares::share_meta),
            )
            .route(
                "/share/api/:token/unlock",
                post(handlers::shares::share_unlock),
            )
            .route(
                "/share/api/:token/list",
                get(handlers::shares::share_list),
            )
            .route(
                "/share/api/:token/download",
                get(handlers::shares::share_download_public),
            )
            .route(
                "/share/api/:token/preview",
                get(handlers::shares::share_preview),
            )
            .nest_service("/share-app", ServeDir::new(web_dir)),
        None => app
            .route("/share/:token", get(handlers::shares::share_view))
            .route(
                "/share/:token/download",
                get(handlers::shares::share_download),
            ),
    }
    .with_state(state);

    tracing::info!(address = %addr, "Loza server started");

    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(error = %error, address = %addr, "failed to bind server listener");
            std::process::exit(1);
        }
    };
    if let Err(error) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    {
        tracing::error!(error = %error, "server stopped unexpectedly");
    }
}
