mod config;
mod db;
mod handlers;
mod models;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post, put},
};
use std::net::SocketAddr;
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

    let app = Router::new()
        .route("/health", get(handlers::auth::health))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/me", get(handlers::auth::me))
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/refresh", post(handlers::auth::refresh))
        .route("/status", get(handlers::status::get_status))
        .route("/ws/status", get(handlers::status::ws_status))
        .route(
            "/calendar/events",
            get(handlers::calendar::get_events).post(handlers::calendar::create_event),
        )
        .route(
            "/calendar/events/:id",
            put(handlers::calendar::update_event).delete(handlers::calendar::delete_event),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(TraceLayer::new_for_http())
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
