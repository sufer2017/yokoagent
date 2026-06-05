-- YokoAgent agent password display migration.
-- Stores admin-visible plaintext passwords for future agent account management.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS password_plaintext TEXT NOT NULL DEFAULT '';

UPDATE agents
SET password_plaintext = CASE username
  WHEN 'gdt-a' THEN 'Ya8pL3qN2x'
  WHEN 'gdt-b' THEN 'R6mT9vK4sQ'
  WHEN 'douyin-a' THEN 'D7xP2nV8cL'
  WHEN 'douyin-b' THEN 'M5qZ8rA1tY'
  WHEN 'kuaishou-a' THEN 'K9vB3sL6pN'
  WHEN 'kuaishou-b' THEN 'H4tQ7xM2wR'
  WHEN 'xhs-a' THEN 'X8nC5yP1zD'
  WHEN 'xhs-b' THEN 'S3lV9kF6aB'
  ELSE password_plaintext
END
WHERE username IN ('gdt-a', 'gdt-b', 'douyin-a', 'douyin-b', 'kuaishou-a', 'kuaishou-b', 'xhs-a', 'xhs-b')
  AND password_plaintext = '';
