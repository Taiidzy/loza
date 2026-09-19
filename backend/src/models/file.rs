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
    /// SHA-256 контента (hex). NULL для директорий и файлов, загруженных до 0004.
    pub sha256: Option<String>,
}

/// Информация о share-ссылке. Никогда не содержит путь к файлу — это
/// внутренняя деталь, которую нельзя раскрывать наружу.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub id: String,
    pub token: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub is_active: bool,
}

/// Тело запроса на создание share-ссылки.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareRequest {
    pub path: String,
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

/// One server-authoritative mutation for several selected filesystem nodes.
/// The response deliberately contains a result per source so callers can show
/// partial failures without inventing local filesystem state.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub operation: BatchOperation,
    pub paths: Vec<String>,
    #[serde(default)]
    pub destination: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BatchOperation {
    Copy,
    Move,
    Delete,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemResult {
    pub path: String,
    pub target_path: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub file: Option<FileInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResponse {
    pub operation: BatchOperation,
    pub results: Vec<BatchItemResult>,
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
/// отказывается в path traversal (..) и вскоре небезопасных имён.
///
/// Пример: "docs/new_folder" → Ok
///         "../etc/passwd"     → Err
///         "/absolute"         → Err (ведущий / не нужен)
pub fn sanitize_path(raw: &str) -> Result<String, FileError> {
    if raw.is_empty()
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || raw.contains('\\')
        || raw.contains('\0')
    {
        return Err(FileError::invalid_path(raw));
    }
    if std::path::Path::new(raw).is_absolute() {
        return Err(FileError::invalid_path(raw));
    }
    if raw.ends_with('/') {
        return Err(FileError::invalid_path(raw));
    }
    if raw.len() > MAX_PATH_LEN {
        return Err(FileError::invalid_path(raw));
    }
    // Reject traversal, ambiguous paths and names that normalise badly on some
    // filesystems. Keep valid Unicode names intact.
    for segment in raw.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.len() > MAX_SEGMENT_LEN
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || segment.chars().any(|c| c.is_control())
        {
            return Err(FileError::invalid_path(raw));
        }
    }
    Ok(raw.to_string())
}

/// Максимальная длина одного элемента пути (имени файла/директории) —
/// ограничение common filesystems (255 байт).
const MAX_SEGMENT_LEN: usize = 255;
/// Общая предельная длина пути в символах — защита от ресурсоёмких путей.
const MAX_PATH_LEN: usize = 2048;

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

#[cfg(test)]
mod tests {
    use super::sanitize_path;

    #[test]
    fn accepts_normal_relative_unicode_paths() {
        assert_eq!(sanitize_path("Документы/отчёт 2026.pdf").unwrap(), "Документы/отчёт 2026.pdf");
    }

    #[test]
    fn rejects_traversal_absolute_and_ambiguous_paths() {
        for path in ["../secret", "docs/../secret", "/etc/passwd", "C:\\temp", "docs//file", "./file", "docs/", ""] {
            assert!(sanitize_path(path).is_err(), "{path} must be rejected");
        }
    }

    #[test]
    fn rejects_control_chars_and_dangling_whitespace() {
        for path in [
            "docs/na\x01me",
            "docs/\n",
            "name.",
            "name ",
            "docs/trailing.",
            "docs/trailing ",
        ] {
            assert!(sanitize_path(path).is_err(), "{path:?} must be rejected");
        }
    }

    #[test]
    fn rejects_excessively_long_segments() {
        let long_segment = "a".repeat(256);
        assert!(sanitize_path(&format!("docs/{long_segment}")).is_err());
        let ok_segment = "b".repeat(255);
        assert!(sanitize_path(&ok_segment).is_ok());
    }

    #[test]
    fn rejects_excessively_long_paths() {
        let mut long_path = String::new();
        for i in 0..600 {
            long_path.push_str(&format!("d{i}/"));
        }
        long_path.push_str("file.txt");
        assert!(sanitize_path(&long_path).is_err());
    }

    #[test]
    fn keeps_normal_relative_unicode_paths() {
        for path in ["docs/sub/file", "file.txt", "照片/夜景.png"] {
            assert!(sanitize_path(path).is_ok(), "{path} must be accepted");
        }
    }
}
