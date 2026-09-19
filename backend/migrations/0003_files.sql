-- Таблица метаданных файлов и директорий.
-- Файлы хранятся в storage/ на диске, а метаданные — в БД для fast-запросов списка.
-- Путь хранится относительным (без ../ и без ведущего /), чтобы предотвратить
-- escape из каталога хранилища.

CREATE TABLE IF NOT EXISTS user_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    -- Относительный путь внутри storage/ пользователя, напр. "docs/report.pdf"
    path        TEXT NOT NULL,
    name        TEXT NOT NULL,
    is_dir      BOOLEAN NOT NULL DEFAULT false,
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    mime_type   TEXT,
    created_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::BIGINT,
    updated_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::BIGINT
);

-- Гарантируем уникальность (username, path) — каждый пользователь имеет
-- собственное "виртуальное" дерево файлов внутри storage/.
CREATE UNIQUE INDEX IF NOT EXISTS user_files_path_idx
    ON user_files(username, path);

-- Индекс для быстрого получения списка файлов пользователя.
CREATE INDEX IF NOT EXISTS user_files_username_idx
    ON user_files(username);

CREATE INDEX IF NOT EXISTS user_files_parent_idx
    ON user_files(username, path);
