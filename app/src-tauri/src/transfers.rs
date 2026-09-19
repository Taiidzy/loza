//! Механизм отмены длительных передач (upload/download).
//!
//! Каждая активная передача регистрирует CancelToken по `progressId`.
//! `cancel_transfer(progressId)` из React снимает токен; вставленные в циклы
//! стриминга `tokio::select!` ловят отмену, бросают "CANCELLED" и чистят
//! временные файлы. Для загрузок отмена дополнительно роняет HTTP-запрос
//! (футур reqwest отбрасывается) — сервер при этом чистит свой temp-файл.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

/// Сигнал отмены одной передачи.
pub struct CancelToken {
    flag: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    pub fn new() -> Arc<Self> {
        Arc::new(CancelToken {
            flag: AtomicBool::new(false),
            notify: Notify::new(),
        })
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Завершается, когда токен отменён. Уже отменённый токен завершается
    /// немедленно (первая проверка флага в цикле).
    pub async fn cancelled(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            self.notify.notified().await;
        }
    }
}

/// Словарь активных передач; защищён мьютексом, так как и создание токена, и
/// отмена приходят из разных команд (async-таски каждого invoke отдельны).
pub struct TransferRegistry {
    inner: Mutex<HashMap<String, Arc<CancelToken>>>,
}

impl TransferRegistry {
    pub fn new() -> Self {
        TransferRegistry {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, progress_id: &str) -> Arc<CancelToken> {
        let token = CancelToken::new();
        if let Ok(mut map) = self.inner.lock() {
            map.insert(progress_id.to_string(), token.clone());
        }
        token
    }

    pub fn finish(&self, progress_id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(progress_id);
        }
    }

    /// Возвращает `true`, если такая передача существовала (была активна).
    pub fn cancel(&self, progress_id: &str) -> bool {
        let token = self
            .inner
            .lock()
            .ok()
            .and_then(|mut map| map.remove(progress_id));
        match token {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }
}

/// `invoke("cancel_transfer", { progressId })` — отменяет активную передачу.
#[tauri::command]
pub fn cancel_transfer(
    state: tauri::State<'_, crate::LozaState>,
    progress_id: String,
) -> Result<bool, String> {
    Ok(state.transfers.cancel(&progress_id))
}