mod db;
mod handlers;
mod models;

use axum::{
    routing::{get, post, put},
    Router,
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
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let port = std::env::var("PORT").unwrap_or_else(|_| "4242".to_string());
    let addr = format!("0.0.0.0:{}", port);

    if let Err(e) = db::storage_fs::ensure_storage_layout() {
        eprintln!("⚠️  Не удалось создать папку storage: {}", e);
    }

    let state = AppState::new(handlers::auth::seed_users());

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
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!("🌿 Loza server listening on http://{}", addr);
    println!("🌿 Loza server listening on http://{}", addr);
    println!("   Тестовые учётки: admin/loza2024 (admin), loza/loza (user)");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
