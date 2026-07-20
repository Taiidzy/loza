mod db;
mod handlers;
mod models;

use axum::{
    routing::{get, post, put},
    Router,
};

use db::AppState;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

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
        .with_state(state);

    println!("🌿 Loza server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
