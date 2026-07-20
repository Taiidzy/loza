use std::fs;
use std::path::{Path, PathBuf};

use crate::models::StorageCategory;

/// Описание категории хранилища: (id, label, папка на диске, цвет).
/// Соответствует палитре и подписям из app/src/api/serverStatus.ts (mockServerStatus).
const CATEGORY_DEFS: &[(&str, &str, &str, &str)] = &[
    ("photos", "Фото", "photos", "#ff9fd0"),
    ("video", "Видео", "video", "#b478ff"),
    ("docs", "Документы", "docs", "#5fb8ff"),
    ("backups", "Бэкапы", "backups", "#3ecf6e"),
    ("other", "Прочее", "other", "#ffbd2e"),
];

/// Корень папки хранилища. Берётся из STORAGE_ROOT или по умолчанию `./storage`
/// рядом с рабочей директорией процесса.
pub fn storage_root() -> PathBuf {
    std::env::var("STORAGE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("storage"))
}

/// Создаёт `storage/` и все подпапки категорий, если их ещё нет.
/// Вызывается один раз при старте сервера.
pub fn ensure_storage_layout() -> std::io::Result<()> {
    let root = storage_root();
    fs::create_dir_all(&root)?;
    for (_, _, dir, _) in CATEGORY_DEFS {
        fs::create_dir_all(root.join(dir))?;
    }
    Ok(())
}

/// Рекурсивно считает суммарный размер файлов в директории.
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if let Ok(meta) = entry.metadata() {
            if meta.is_dir() {
                total += dir_size(&p);
            } else {
                total += meta.len();
            }
        }
    }
    total
}

/// Сканирует папку storage и считает размер каждой категории.
pub fn scan_categories() -> Vec<StorageCategory> {
    let root = storage_root();
    CATEGORY_DEFS
        .iter()
        .map(|(id, label, dir, color)| StorageCategory {
            id: id.to_string(),
            label: label.to_string(),
            bytes: dir_size(&root.join(dir)),
            color: color.to_string(),
        })
        .collect()
}
