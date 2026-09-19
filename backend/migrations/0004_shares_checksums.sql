-- Миграция 0004: чексуммы файлов и публичные share-ссылки.

-- SHA-256 каждого файла, посчитанный сервером во время загрузки.
-- NULL для файлов, загруженных до этого обновления — они попадут в
-- реконсиляцию storage и при необходимости будут пересчитаны/помечены.
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS sha256_hex TEXT;

-- Публичные ссылки на файлы.
-- Ссылка привязывается к конкретному файлу по id, а НЕ по пути:
--   - переименование/перемещение файла не ломает ссылку;
--   - новый файл, загруженный на то же место, не наследует чужие ссылки;
--   - удаление файла каскадно отзывает ссылку.
CREATE TABLE IF NOT EXISTS file_shares (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id     UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    created_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::BIGINT,
    expires_at  BIGINT,
    is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS file_shares_file_id_idx ON file_shares(file_id);
CREATE INDEX IF NOT EXISTS file_shares_username_idx ON file_shares(username);
CREATE INDEX IF NOT EXISTS file_shares_expires_idx ON file_shares(expires_at);