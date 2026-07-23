use sqlx::{PgPool, Row};

use crate::models::{CalendarEvent, PublicUser, Recurrence, Session, User};

pub async fn connect_and_migrate(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .min_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

fn user_from_row(row: sqlx::postgres::PgRow) -> User {
    User {
        username: row.get("username"),
        password_hash: row.get("password_hash"),
        display_name: row.get("display_name"),
        role: row.get("role"),
        quota_bytes: row
            .get::<Option<i64>, _>("quota_bytes")
            .and_then(|value| u64::try_from(value).ok()),
    }
}

pub async fn count_users(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
}

pub async fn find_user(pool: &PgPool, username: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query("SELECT username, password_hash, display_name, role, quota_bytes FROM users WHERE username = $1")
        .bind(username)
        .fetch_optional(pool)
        .await
        .map(|row| row.map(user_from_row))
}

pub async fn list_users(pool: &PgPool) -> Result<Vec<PublicUser>, sqlx::Error> {
    sqlx::query("SELECT username, display_name, role, quota_bytes FROM users ORDER BY username")
        .fetch_all(pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(|row| PublicUser {
                    username: row.get("username"),
                    display_name: row.get("display_name"),
                    role: row.get("role"),
                    quota_bytes: row
                        .get::<Option<i64>, _>("quota_bytes")
                        .and_then(|value| u64::try_from(value).ok()),
                })
                .collect()
        })
}

pub async fn create_user(pool: &PgPool, user: &User) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO users (username, password_hash, display_name, role, quota_bytes) VALUES ($1, $2, $3, $4, $5)")
        .bind(&user.username)
        .bind(&user.password_hash)
        .bind(&user.display_name)
        .bind(&user.role)
        .bind(user.quota_bytes.map(|value| value as i64))
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn update_password(
    pool: &PgPool,
    username: &str,
    password_hash: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE username = $2")
        .bind(password_hash)
        .bind(username)
        .execute(pool)
        .await
        .map(|result| result.rows_affected() == 1)
}

pub async fn update_quota(
    pool: &PgPool,
    username: &str,
    quota_bytes: Option<u64>,
) -> Result<Option<PublicUser>, sqlx::Error> {
    sqlx::query("UPDATE users SET quota_bytes = $1, updated_at = now() WHERE username = $2 RETURNING username, display_name, role, quota_bytes")
        .bind(quota_bytes.map(|value| value as i64))
        .bind(username)
        .fetch_optional(pool)
        .await
        .map(|row| row.map(|row| PublicUser {
            username: row.get("username"),
            display_name: row.get("display_name"),
            role: row.get("role"),
            quota_bytes: row.get::<Option<i64>, _>("quota_bytes").and_then(|value| u64::try_from(value).ok()),
        }))
}

pub async fn delete_user(pool: &PgPool, username: &str) -> Result<bool, sqlx::Error> {
    sqlx::query("DELETE FROM users WHERE username = $1")
        .bind(username)
        .execute(pool)
        .await
        .map(|result| result.rows_affected() == 1)
}

fn session_from_row(row: sqlx::postgres::PgRow) -> Session {
    Session {
        public_id: row.get("public_id"),
        // Токен намеренно не хранится в БД. Вызывающий код уже владеет им.
        token: String::new(),
        username: row.get("username"),
        device: row.get("device"),
        created_at: row.get::<i64, _>("created_at") as u64,
        last_seen: row.get::<i64, _>("last_seen_at") as u64,
        expires_at: row.get::<i64, _>("expires_at") as u64,
    }
}

pub async fn create_session(
    pool: &PgPool,
    token_hash: &str,
    session: &Session,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO sessions (token_hash, public_id, username, device, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(token_hash)
        .bind(&session.public_id)
        .bind(&session.username)
        .bind(&session.device)
        .bind(session.created_at as i64)
        .bind(session.last_seen as i64)
        .bind(session.expires_at as i64)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn touch_session(
    pool: &PgPool,
    token_hash: &str,
    now: u64,
) -> Result<Option<Session>, sqlx::Error> {
    sqlx::query("UPDATE sessions SET last_seen_at = $1 WHERE token_hash = $2 AND expires_at > $1 RETURNING public_id, username, device, created_at, last_seen_at, expires_at")
        .bind(now as i64)
        .bind(token_hash)
        .fetch_optional(pool)
        .await
        .map(|row| row.map(session_from_row))
}

pub async fn list_sessions(pool: &PgPool) -> Result<Vec<Session>, sqlx::Error> {
    sqlx::query("SELECT public_id, username, device, created_at, last_seen_at, expires_at FROM sessions WHERE expires_at > EXTRACT(EPOCH FROM now())::BIGINT ORDER BY last_seen_at DESC")
        .fetch_all(pool)
        .await
        .map(|rows| rows.into_iter().map(session_from_row).collect())
}

pub async fn delete_session(pool: &PgPool, token_hash: &str) -> Result<bool, sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
        .bind(token_hash)
        .execute(pool)
        .await
        .map(|result| result.rows_affected() == 1)
}

pub async fn delete_sessions_for_user(pool: &PgPool, username: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE username = $1")
        .bind(username)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn delete_expired_sessions(pool: &PgPool, now: u64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE expires_at <= $1")
        .bind(now as i64)
        .execute(pool)
        .await
        .map(|_| ())
}

fn event_from_row(row: sqlx::postgres::PgRow) -> CalendarEvent {
    let recurrence = match row.get::<String, _>("recurrence").as_str() {
        "daily" => Recurrence::Daily,
        "weekly" => Recurrence::Weekly,
        "monthly" => Recurrence::Monthly,
        "yearly" => Recurrence::Yearly,
        _ => Recurrence::None,
    };
    CalendarEvent {
        id: row.get("id"),
        title: row.get("title"),
        start_date: row.get("start_date"),
        end_date: row.get("end_date"),
        start_time: row.get("start_time"),
        end_time: row.get("end_time"),
        color: row.get("color"),
        recurrence,
        is_multi_day: row.get("is_multi_day"),
        is_all_day: row.get("is_all_day"),
    }
}

fn recurrence_value(recurrence: &Recurrence) -> &'static str {
    match recurrence {
        Recurrence::None => "none",
        Recurrence::Daily => "daily",
        Recurrence::Weekly => "weekly",
        Recurrence::Monthly => "monthly",
        Recurrence::Yearly => "yearly",
    }
}

pub async fn list_events(pool: &PgPool, username: &str) -> Result<Vec<CalendarEvent>, sqlx::Error> {
    sqlx::query("SELECT id, title, start_date, end_date, start_time, end_time, color, recurrence, is_multi_day, is_all_day FROM calendar_events WHERE username = $1 ORDER BY start_date, start_time NULLS FIRST, id")
        .bind(username)
        .fetch_all(pool)
        .await
        .map(|rows| rows.into_iter().map(event_from_row).collect())
}

pub async fn create_event(
    pool: &PgPool,
    username: &str,
    event: &CalendarEvent,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO calendar_events (id, username, title, start_date, end_date, start_time, end_time, color, recurrence, is_multi_day, is_all_day) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)")
        .bind(&event.id).bind(username).bind(&event.title).bind(&event.start_date).bind(&event.end_date)
        .bind(&event.start_time).bind(&event.end_time).bind(&event.color).bind(recurrence_value(&event.recurrence))
        .bind(event.is_multi_day).bind(event.is_all_day).execute(pool).await.map(|_| ())
}

pub async fn update_event(
    pool: &PgPool,
    username: &str,
    id: &str,
    event: &CalendarEvent,
) -> Result<bool, sqlx::Error> {
    sqlx::query("UPDATE calendar_events SET title = $1, start_date = $2, end_date = $3, start_time = $4, end_time = $5, color = $6, recurrence = $7, is_multi_day = $8, is_all_day = $9, updated_at = now() WHERE id = $10 AND username = $11")
        .bind(&event.title).bind(&event.start_date).bind(&event.end_date).bind(&event.start_time).bind(&event.end_time)
        .bind(&event.color).bind(recurrence_value(&event.recurrence)).bind(event.is_multi_day).bind(event.is_all_day)
        .bind(id).bind(username).execute(pool).await.map(|result| result.rows_affected() == 1)
}

pub async fn delete_event(pool: &PgPool, username: &str, id: &str) -> Result<bool, sqlx::Error> {
    sqlx::query("DELETE FROM calendar_events WHERE id = $1 AND username = $2")
        .bind(id)
        .bind(username)
        .execute(pool)
        .await
        .map(|result| result.rows_affected() == 1)
}
