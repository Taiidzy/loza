use chrono::DateTime;
use serde::{Deserialize, Serialize};

pub fn fmt_ts(ts: i64) -> String {
    DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_default()
}

/// Метаданные файла или директории, как их видит пользователь.
/// Зеркалирует `FileInfo` из app/src/types/files.ts.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Тело запроса на создание директории.
#[derive(Debug, Deserialize)]
pub struct CreateDirRequest {
    pub path: String, // relative path, e.g. "docs/new_folder"
}

/// Тело запроса на переименование / перемещение.
#[derive(Debug, Deserialize)]
pub struct MoveRequest {
    pub from: String,
    pub to: String,
}

/// Тело запроса на копирование.
#[derive(Debug, Deserialize, Clone)]
pub struct CopyRequest {
    pub from: String,
    pub to: String,
}

/// Ошибка файловой операции — транспортно-независимая, как CalendarError.
#[derive(Debug, Clone)]
pub struct FileError {
    pub code: String,
    pub message: String,
}

impl FileError {
    pub fn new(code: &str, message: &str) -> Self {
        FileError {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn not_found(path: &str) -> Self {
        FileError::new("FILE_NOT_FOUND", &format!("File or directory not found: {path}"))
    }

    pub fn conflict(path: &str) -> Self {
        FileError::new("PATH_EXISTS", &format!("A file or directory already exists at: {path}"))
    }

    pub fn invalid_path(path: &str) -> Self {
        FileError::new("INVALID_PATH", &format!("Invalid path: {path}"))
    }

    #[allow(dead_code)]
    pub fn is_dir(path: &str) -> Self {
        FileError::new("IS_DIRECTORY", &format!("{path} is a directory"))
    }

    #[allow(dead_code)]
    pub fn not_a_dir(path: &str) -> Self {
        FileError::new("NOT_A_DIRECTORY", &format!("{path} is not a directory"))
    }
}

impl From<std::io::Error> for FileError {
    fn from(err: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match err.kind() {
            ErrorKind::NotFound => FileError::new("IO_NOT_FOUND", &err.to_string()),
            ErrorKind::PermissionDenied => {
                FileError::new("IO_PERMISSION_DENIED", &err.to_string())
            }
            ErrorKind::AlreadyExists => FileError::new("IO_ALREADY_EXISTS", &err.to_string()),
            _ => FileError::new("IO_ERROR", &err.to_string()),
        }
    }
}

impl From<sqlx::Error> for FileError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(error = %err, "file database operation failed");
        FileError::new("DATABASE_UNAVAILABLE", "The database is temporarily unavailable")
    }
}

/// Приводит путь к «чистому» виду: убирает ведущие и trailing слеши,
/// отказывается в path traversal (..).
///
/// Пример: "docs/new_folder" → Ok
///         "../etc/passwd"     → Err
///         "/absolute"         → Err (ведущий / не нужен)
pub fn sanitize_path(raw: &str) -> Result<String, FileError> {
    let trimmed = raw.trim().trim_matches('/').to_string();
    if trimmed.is_empty() {
        return Err(FileError::new("INVALID_PATH", "Path must not be empty"));
    }
    // Отклоняем любые сегменты .. — даже в середине пути.
    for segment in trimmed.split('/') {
        if segment == ".." {
            return Err(FileError::invalid_path(raw));
        }
        if segment.is_empty() {
            return Err(FileError::invalid_path(raw));
        }
    }
    Ok(trimmed)
}

/// Нормализует путь директории: гарантированно заканчивается на `/`.
#[allow(dead_code)]
pub fn normalize_dir_path(raw: &str) -> Result<String, FileError> {
    let sanitized = sanitize_path(raw)?;
    if !sanitized.ends_with('/') {
        Ok(format!("{sanitized}/"))
    } else {
        Ok(sanitized)
    }
}

/// Разделяет путь на (директория, имя файла/директории).
/// "docs/sub/file.txt" → Some(("docs/sub", "file.txt"))
/// "file.txt"          → Some(("", "file.txt"))
/// ""                  → None
pub fn split_parent(path: &str) -> Option<(&str, &str)> {
    let path = path.trim_matches('/');
    if path.is_empty() {
        return None;
    }
    match path.rfind('/') {
        Some(idx) => Some((&path[..idx], &path[idx + 1..])),
        None => Some(("", path)),
    }
}

/// Определяет MIME-тип по расширению имени файла.
pub fn guess_mime(name: &str) -> Option<&'static str> {
    let ext = name.rsplit('.').next().and_then(|e| {
        let lower = e.to_ascii_lowercase();
        if lower.len() < 2 || lower.len() > 8 {
            None
        } else {
            Some(lower)
        }
    });
    match ext.as_deref() {
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("bmp") => Some("image/bmp"),
        Some("svg") => Some("image/svg+xml"),
        Some("avif") => Some("image/avif"),
        Some("pdf") => Some("application/pdf"),
        Some("txt") => Some("text/plain"),
        Some("md") => Some("text/markdown"),
        Some("json") => Some("application/json"),
        Some("xml") => Some("application/xml"),
        Some("yaml" | "yml") => Some("application/yaml"),
        Some("toml") => Some("application/toml"),
        Some("ini") => Some("text/plain"),
        Some("csv") => Some("text/csv"),
        Some("html" | "htm") => Some("text/html"),
        Some("css") => Some("text/css"),
        Some("js") => Some("application/javascript"),
        Some("ts") => Some("application/typescript"),
        Some("py") => Some("text/x-python"),
        Some("rs") => Some("text/x-rust"),
        Some("go") => Some("text/x-go"),
        Some("c") => Some("text/x-c"),
        Some("cpp" | "cc" | "cxx") => Some("text/x-c++"),
        Some("h") => Some("text/x-c"),
        Some("hpp") => Some("text/x-c++"),
        Some("sh") => Some("application/x-sh"),
        Some("log") => Some("text/plain"),
        Some("mp4") => Some("video/mp4"),
        Some("webm") => Some("video/webm"),
        Some("mov") => Some("video/quicktime"),
        Some("avi") => Some("video/x-msvideo"),
        Some("mkv") => Some("video/x-matroska"),
        Some("mp3") => Some("audio/mpeg"),
        Some("wav") => Some("audio/wav"),
        Some("ogg") => Some("audio/ogg"),
        Some("flac") => Some("audio/flac"),
        Some("m4a") => Some("audio/mp4"),
        Some("zip") => Some("application/zip"),
        Some("tar") => Some("application/x-tar"),
        Some("gz") => Some("application/gzip"),
        Some("7z") => Some("application/x-7z"),
        Some("rar") => Some("application/vnd.rar"),
        Some("doc") => Some("application/msword"),
        Some("docx") => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        Some("xls") => Some("application/vnd.ms-excel"),
        Some("xlsx") => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Some("ppt") => Some("application/vnd.ms-powerpoint"),
        Some("pptx") => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        _ => None,
    }
}
