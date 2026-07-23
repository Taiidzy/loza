use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use sqlx::PgPool;
use sysinfo::System;

use crate::models::Session;

/// Сколько последних замеров CPU/RAM хранить для sparkline-графика нагрузки
/// (LoadInfo.history во фронтенде — "last N samples").
pub const LOAD_HISTORY_CAPACITY: usize = 30;

/// Сколько последних дневных замеров занятости диска хранить для storage.history7d.
pub const STORAGE_HISTORY_DAYS: usize = 7;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub sessions: Arc<RwLock<HashMap<String, Session>>>,
    /// Общий sysinfo::System, переиспользуется между опросами (так рекомендует sysinfo).
    pub sys: Arc<Mutex<System>>,
    /// Кольцевой буфер последних замеров % загрузки CPU — источник LoadInfo.history.
    pub load_history: Arc<RwLock<Vec<f32>>>,
    /// Дневные замеры % занятости диска — источник StorageInfo.history7d.
    pub storage_history: Arc<RwLock<Vec<f32>>>,
    /// Unix-время последнего добавленного дневного замера — чтобы не писать
    /// в storage_history на каждый тик статуса (раз в 2 сек), а раз в сутки.
    pub last_storage_sample_at: Arc<RwLock<u64>>,
    pub started_at: u64,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            sys: Arc::new(Mutex::new(System::new_all())),
            load_history: Arc::new(RwLock::new(Vec::with_capacity(LOAD_HISTORY_CAPACITY))),
            storage_history: Arc::new(RwLock::new(Vec::with_capacity(STORAGE_HISTORY_DAYS))),
            last_storage_sample_at: Arc::new(RwLock::new(0)),
            started_at: crate::handlers::auth::now_secs(),
        }
    }

    pub fn push_load_sample(&self, value: f32) {
        let mut hist = self.load_history.write().unwrap();
        hist.push(value);
        let len = hist.len();
        if len > LOAD_HISTORY_CAPACITY {
            hist.drain(0..len - LOAD_HISTORY_CAPACITY);
        }
    }

    /// Добавляет дневной замер % занятости диска не чаще раза в сутки.
    pub fn maybe_push_storage_sample(&self, value: f32, now: u64) {
        const ONE_DAY_SECS: u64 = 86_400;
        let mut last = self.last_storage_sample_at.write().unwrap();
        if now.saturating_sub(*last) < ONE_DAY_SECS && *last != 0 {
            return;
        }
        *last = now;
        drop(last);

        let mut hist = self.storage_history.write().unwrap();
        hist.push(value);
        let len = hist.len();
        if len > STORAGE_HISTORY_DAYS {
            hist.drain(0..len - STORAGE_HISTORY_DAYS);
        }
    }
}
