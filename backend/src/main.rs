mod db;
mod handlers;
mod models;

use axum::{
    Router,
    routing::{get, post, put},
};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

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

    let port = std::env::var("PORT").unwrap_or_else(|_| "4242".to_string());
    let addr = format!("0.0.0.0:{}", port);

    if let Err(error) = db::storage_fs::ensure_storage_layout() {
        tracing::error!(error = %error, "storage layout initialization failed");
        std::process::exit(1);
    }

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(value) => value,
        Err(_) => {
            tracing::error!("DATABASE_URL is required");
            std::process::exit(1);
        }
    };
    let pool = match db::repository::connect_and_migrate(&database_url).await {
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
    let state = AppState::new(pool);

    let app = Router::new()
        .route("/health", get(handlers::auth::health))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/me", get(handlers::auth::me))
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/refresh", post(handlers::auth::refresh))
        .route(
            "/users",
            get(handlers::auth::list_users).post(handlers::auth::create_user),
        )
        .route(
            "/users/:username",
            axum::routing::delete(handlers::auth::delete_user),
        )
        .route(
            "/users/:username/password",
            put(handlers::auth::change_password),
        )
        .route(
            "/users/:username/quota",
            put(handlers::auth::update_user_quota),
        )
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
    if let Err(error) = axum::serve(listener, app).await {
        tracing::error!(error = %error, "server stopped unexpectedly");
    }
}
