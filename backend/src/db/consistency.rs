//! Реконсиляция хранилища: восстановление консистентности «БД ⇄ диск».
//!
//! Запускается при старте сервера в фоне и приводит хранилище в состояние,
//! при котором не остаётся ни «осиротевших» записей (row есть, файла нет),
//! ни «осиротевших» файлов (файл есть, row нет), ни временных артефактов
//! прерванных загрузок (`.loza-part`).

use std::collections::HashSet;
use std::path::Path;

use sqlx::PgPool;

use crate::handlers::files::user_root;

/// Признак временного файла атомарной загрузки: `.«имя».«uuid».loza-part`.
fn is_temp_artifact(name: &str) -> bool {
    name.ends_with(".loza-part")
}

pub async fn reconcile_storage(pool: &PgPool) {
    let users = match sqlx::query_scalar::<_, String>("SELECT username FROM users")
        .fetch_all(pool)
        .await
    {
        Ok(users) => users,
        Err(error) => {
            tracing::warn!(%error, "storage reconciliation: cannot list users; skipping");
            return;
        }
    };

    let mut removed_rows = 0usize;
    let mut removed_files = 0usize;

    for username in users {
        let root = user_root(&username);
        if !root.exists() {
            continue;
        }

        // DB → диск: удаляем записи, чей файл/папка исчезли с диска.
        let rows = match sqlx::query_as::<_, (String, bool)>(
            "SELECT path, is_dir FROM user_files WHERE username = $1",
        )
        .bind(&username)
        .fetch_all(pool)
        .await
        {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!(%error, %username, "storage reconciliation: DB read failed; skipping user");
                continue;
            }
        };

        let mut db_paths: HashSet<String> = HashSet::with_capacity(rows.len());
        for (path, _is_dir) in &rows {
            db_paths.insert(path.clone());
            let full = root.join(path);
            if tokio::fs::symlink_metadata(&full).await.is_err() {
                tracing::info!(
                    %username, %path,
                    "storage reconciliation: removing DB row for missing disk entry"
                );
                match sqlx::query("DELETE FROM user_files WHERE username = $1 AND path = $2")
                    .bind(&username)
                    .bind(path)
                    .execute(pool)
                    .await
                {
                    Ok(_) => removed_rows += 1,
                    Err(error) => tracing::warn!(%error, %username, %path, "reconciliation: DB delete failed"),
                }
            }
        }

        // Диск → БД: убираем файлы/папки/артефакты без записи в БД.
        match remove_orphan_entries(&root, "", &root, &db_paths, &mut removed_files).await {
            Ok(()) => {}
            Err(error) => tracing::warn!(%error, %username, "reconciliation: disk walk failed"),
        }
    }

    tracing::info!(
        removed_rows,
        removed_files,
        "storage reconciliation finished"
    );
}

/// Рекурсивно удаляет всё, что не является записью БД. Симлинки Loza не
/// поддерживает в принципе — их ссылки удаляются, сам объект не трогается.
async fn remove_orphan_entries(
    root: &Path,
    relay: &str,
    dir: &Path,
    db_paths: &HashSet<String>,
    removed: &mut usize,
) -> std::io::Result<()> {
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let file_name = entry.file_name().to_string_lossy().to_string();
        let rel_path = if relay.is_empty() {
            file_name.clone()
        } else {
            format!("{relay}/{file_name}")
        };
        let ft = entry.file_type().await?;

        if ft.is_symlink() {
            tracing::info!(
                dir = %root.display(),
                %rel_path,
                "storage reconciliation: removing unsupported symlink"
            );
            tokio::fs::remove_file(entry.path()).await?;
            *removed += 1;
            continue;
        }

        if ft.is_dir() {
            if db_paths.contains(&rel_path) {
                Box::pin(remove_orphan_entries(root, &rel_path, &entry.path(), db_paths, removed))
                    .await?;
            } else {
                tracing::info!(
                    dir = %root.display(),
                    %rel_path,
                    "storage reconciliation: removing orphan directory from disk"
                );
                tokio::fs::remove_dir_all(entry.path()).await?;
                *removed += 1;
            }
            continue;
        }

        if is_temp_artifact(&file_name) || !db_paths.contains(&rel_path) {
            tracing::info!(
                dir = %root.display(),
                %rel_path,
                "storage reconciliation: removing orphan file from disk"
            );
            tokio::fs::remove_file(entry.path()).await?;
            *removed += 1;
        }
    }
    Ok(())
}