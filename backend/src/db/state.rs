use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use sysinfo::System;

use crate::models::{CalendarEvent, Session, User};

/// Сколько последних замеров CPU/RAM хранить для sparkline-графика нагрузки
/// (LoadInfo.history во фронтенде — "last N samples").
pub const LOAD_HISTORY_CAPACITY: usize = 30;

/// Сколько последних дневных замеров занятости диска хранить для storage.history7d.
pub const STORAGE_HISTORY_DAYS: usize = 7;

#[derive(Clone)]
pub struct AppState {
    pub sessions: Arc<RwLock<HashMap<String, Session>>>,
    pub users: Arc<RwLock<HashMap<String, User>>>,
    /// Общий sysinfo::System, переиспользуется между опросами (так рекомендует sysinfo).
    pub sys: Arc<Mutex<System>>,
    /// Кольцевой буфер последних замеров % загрузки CPU — источник LoadInfo.history.
    pub load_history: Arc<RwLock<Vec<f32>>>,
    /// Дневные замеры % занятости диска — источник StorageInfo.history7d.
    pub storage_history: Arc<RwLock<Vec<f32>>>,
    /// Unix-время последнего добавленного дневного замера — чтобы не писать
    /// в storage_history на каждый тик статуса (раз в 2 сек), а раз в сутки.
    pub last_storage_sample_at: Arc<RwLock<u64>>,
    /// События календаря, привязанные к username — у каждого пользователя
    /// свой список (см. handlers/calendar.rs). In-memory, как sessions/users:
    /// переживает ре-рендеры и переключение вкладок на клиенте, но не
    /// переживает перезапуск backend-процесса.
    pub events: Arc<RwLock<HashMap<String, Vec<CalendarEvent>>>>,
}

impl AppState {
    pub fn new(users: HashMap<String, User>) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            users: Arc::new(RwLock::new(users)),
            sys: Arc::new(Mutex::new(System::new_all())),
            load_history: Arc::new(RwLock::new(Vec::with_capacity(LOAD_HISTORY_CAPACITY))),
            storage_history: Arc::new(RwLock::new(Vec::with_capacity(STORAGE_HISTORY_DAYS))),
            last_storage_sample_at: Arc::new(RwLock::new(0)),
            events: Arc::new(RwLock::new(HashMap::new())),
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
