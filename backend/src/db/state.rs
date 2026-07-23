use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use sqlx::PgPool;
use sysinfo::System;

use crate::config::Config;
use crate::models::StorageCategory;

/// Сколько последних замеров CPU/RAM хранить для sparkline-графика нагрузки
/// (LoadInfo.history во фронтенде — "last N samples").
pub const LOAD_HISTORY_CAPACITY: usize = 30;

/// Сколько последних дневных замеров занятости диска хранить для storage.history7d.
pub const STORAGE_HISTORY_DAYS: usize = 7;
const LOGIN_FAILURE_WINDOW_SECS: u64 = 15 * 60;
const MAX_LOGIN_FAILURES: u32 = 5;
const MAX_LOGIN_RATE_LIMIT_ENTRIES: usize = 10_000;
const STORAGE_CATEGORY_CACHE_SECS: u64 = 60;
const MAX_STATUS_WS_CONNECTIONS: usize = 20;

#[derive(Clone, Copy)]
struct LoginAttempt {
    failures: u32,
    window_started_at: u64,
    blocked_until: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Config,
    login_attempts: Arc<Mutex<HashMap<String, LoginAttempt>>>,
    /// Общий sysinfo::System, переиспользуется между опросами (так рекомендует sysinfo).
    pub sys: Arc<Mutex<System>>,
    /// Кольцевой буфер последних замеров % загрузки CPU — источник LoadInfo.history.
    pub load_history: Arc<RwLock<Vec<f32>>>,
    /// Дневные замеры % занятости диска — источник StorageInfo.history7d.
    pub storage_history: Arc<RwLock<Vec<f32>>>,
    storage_categories: Arc<Mutex<Option<(u64, Vec<StorageCategory>)>>>,
    status_ws_connections: Arc<AtomicUsize>,
    /// Unix-время последнего добавленного дневного замера — чтобы не писать
    /// в storage_history на каждый тик статуса (раз в 2 сек), а раз в сутки.
    pub last_storage_sample_at: Arc<RwLock<u64>>,
    pub started_at: u64,
}

impl AppState {
    pub fn new(pool: PgPool, config: Config) -> Self {
        Self {
            pool,
            config,
            login_attempts: Arc::new(Mutex::new(HashMap::new())),
            sys: Arc::new(Mutex::new(System::new_all())),
            load_history: Arc::new(RwLock::new(Vec::with_capacity(LOAD_HISTORY_CAPACITY))),
            storage_history: Arc::new(RwLock::new(Vec::with_capacity(STORAGE_HISTORY_DAYS))),
            storage_categories: Arc::new(Mutex::new(None)),
            status_ws_connections: Arc::new(AtomicUsize::new(0)),
            last_storage_sample_at: Arc::new(RwLock::new(0)),
            started_at: crate::handlers::auth::now_secs(),
        }
    }

    pub fn push_load_sample(&self, value: f32) {
        let Ok(mut hist) = self.load_history.write() else {
            tracing::error!("load history lock is poisoned");
            return;
        };
        hist.push(value);
        let len = hist.len();
        if len > LOAD_HISTORY_CAPACITY {
            hist.drain(0..len - LOAD_HISTORY_CAPACITY);
        }
    }

    /// Добавляет дневной замер % занятости диска не чаще раза в сутки.
    pub fn maybe_push_storage_sample(&self, value: f32, now: u64) {
        const ONE_DAY_SECS: u64 = 86_400;
        let Ok(mut last) = self.last_storage_sample_at.write() else {
            tracing::error!("storage sample timestamp lock is poisoned");
            return;
        };
        if now.saturating_sub(*last) < ONE_DAY_SECS && *last != 0 {
            return;
        }
        *last = now;
        drop(last);

        let Ok(mut hist) = self.storage_history.write() else {
            tracing::error!("storage history lock is poisoned");
            return;
        };
        hist.push(value);
        let len = hist.len();
        if len > STORAGE_HISTORY_DAYS {
            hist.drain(0..len - STORAGE_HISTORY_DAYS);
        }
    }

    pub fn is_login_rate_limited(&self, ip: IpAddr, username: &str, now: u64) -> bool {
        let Ok(attempts) = self.login_attempts.lock() else {
            return true;
        };
        attempts
            .get(&login_attempt_key(ip, username))
            .is_some_and(|attempt| attempt.blocked_until > now)
    }

    pub fn record_login_failure(&self, ip: IpAddr, username: &str, now: u64) {
        let Ok(mut attempts) = self.login_attempts.lock() else {
            return;
        };
        if attempts.len() >= MAX_LOGIN_RATE_LIMIT_ENTRIES {
            attempts.retain(|_, attempt| {
                now.saturating_sub(attempt.window_started_at) < LOGIN_FAILURE_WINDOW_SECS
                    || attempt.blocked_until > now
            });
            if attempts.len() >= MAX_LOGIN_RATE_LIMIT_ENTRIES {
                return;
            }
        }

        let attempt = attempts
            .entry(login_attempt_key(ip, username))
            .or_insert(LoginAttempt {
                failures: 0,
                window_started_at: now,
                blocked_until: 0,
            });
        if now.saturating_sub(attempt.window_started_at) >= LOGIN_FAILURE_WINDOW_SECS {
            *attempt = LoginAttempt {
                failures: 0,
                window_started_at: now,
                blocked_until: 0,
            };
        }
        attempt.failures += 1;
        if attempt.failures >= MAX_LOGIN_FAILURES {
            attempt.blocked_until = now + LOGIN_FAILURE_WINDOW_SECS;
        }
    }

    pub fn clear_login_failures(&self, ip: IpAddr, username: &str) {
        if let Ok(mut attempts) = self.login_attempts.lock() {
            attempts.remove(&login_attempt_key(ip, username));
        }
    }

    pub fn storage_categories(&self, now: u64) -> Vec<StorageCategory> {
        let Ok(mut cached) = self.storage_categories.lock() else {
            return Vec::new();
        };
        if let Some((cached_at, categories)) = cached.as_ref()
            && now.saturating_sub(*cached_at) < STORAGE_CATEGORY_CACHE_SECS
        {
            return categories.clone();
        }

        let categories = crate::db::storage_fs::scan_categories();
        *cached = Some((now, categories.clone()));
        categories
    }

    pub fn try_acquire_status_ws(&self) -> bool {
        let mut current = self.status_ws_connections.load(Ordering::Relaxed);
        loop {
            if current >= MAX_STATUS_WS_CONNECTIONS {
                return false;
            }
            match self.status_ws_connections.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => return true,
                Err(next) => current = next,
            }
        }
    }

    pub fn release_status_ws(&self) {
        self.status_ws_connections.fetch_sub(1, Ordering::AcqRel);
    }
}

fn login_attempt_key(ip: IpAddr, username: &str) -> String {
    format!("{ip}:{}", username.chars().take(32).collect::<String>())
}

#[cfg(test)]
mod tests {
    use std::net::IpAddr;

    use sqlx::PgPool;

    use super::AppState;
    use crate::config::Config;

    fn state() -> AppState {
        AppState::new(
            PgPool::connect_lazy("postgres://loza:loza@localhost/loza").unwrap(),
            Config {
                database_url: "postgres://loza:loza@localhost/loza".to_string(),
                jwt_secret: "a_secure_test_secret_that_is_long_enough".to_string(),
                port: 4242,
                trust_proxy_headers: false,
            },
        )
    }

    #[tokio::test]
    async fn login_failures_are_limited_and_can_be_cleared() {
        let state = state();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        let now = 1_000;

        for _ in 0..5 {
            state.record_login_failure(ip, "admin", now);
        }

        assert!(state.is_login_rate_limited(ip, "admin", now));
        state.clear_login_failures(ip, "admin");
        assert!(!state.is_login_rate_limited(ip, "admin", now));
    }
}
