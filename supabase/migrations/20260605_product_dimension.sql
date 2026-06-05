-- YokoAgent product-dimension migration for existing Phase-1 Supabase databases.
-- Run once before deploying the product-dimension application code.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS products (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO products (name, is_active)
VALUES ('默认产品', true)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS product_id UUID;
UPDATE agents
SET product_id = (SELECT id FROM products WHERE name = '默认产品' LIMIT 1)
WHERE product_id IS NULL;
ALTER TABLE agents ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS feishu_webhook TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_product_id_fkey'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_channel_id_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_product_id_channel_id_name_key'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_product_id_channel_id_name_key
      UNIQUE (product_id, channel_id, name);
  END IF;
END $$;

ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS product_id UUID;
UPDATE daily_records AS record
SET product_id = agent.product_id
FROM agents AS agent
WHERE record.agent_id = agent.id
  AND record.product_id IS NULL;
UPDATE daily_records
SET product_id = (SELECT id FROM products WHERE name = '默认产品' LIMIT 1)
WHERE product_id IS NULL;
ALTER TABLE daily_records ALTER COLUMN product_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_records_product_id_fkey'
  ) THEN
    ALTER TABLE daily_records
      ADD CONSTRAINT daily_records_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_agent_id_channel_id_record_date_creative_type_key;
ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_agent_id_record_date_creative_type_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_records_product_id_agent_id_channel_id_record_date_creative_type_key'
  ) THEN
    ALTER TABLE daily_records
      ADD CONSTRAINT daily_records_product_id_agent_id_channel_id_record_date_creative_type_key
      UNIQUE (product_id, agent_id, channel_id, record_date, creative_type);
  END IF;
END $$;

ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS product_id UUID;
UPDATE target_changes AS target
SET product_id = agent.product_id
FROM agents AS agent
WHERE target.agent_id = agent.id
  AND target.product_id IS NULL;
UPDATE target_changes
SET product_id = (SELECT id FROM products WHERE name = '默认产品' LIMIT 1)
WHERE product_id IS NULL;
ALTER TABLE target_changes ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS creative_type TEXT NOT NULL DEFAULT '';
ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS activation_cap NUMERIC(14, 2) CHECK (activation_cap >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'target_changes_product_id_fkey'
  ) THEN
    ALTER TABLE target_changes
      ADD CONSTRAINT target_changes_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE target_changes DROP CONSTRAINT IF EXISTS target_changes_agent_id_effective_date_key;
ALTER TABLE target_changes DROP CONSTRAINT IF EXISTS target_changes_agent_id_channel_id_effective_date_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'target_changes_product_id_agent_id_channel_id_creative_type_effective_date_key'
  ) THEN
    ALTER TABLE target_changes
      ADD CONSTRAINT target_changes_product_id_agent_id_channel_id_creative_type_effective_date_key
      UNIQUE (product_id, agent_id, channel_id, creative_type, effective_date);
  END IF;
END $$;

ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS product_id UUID;
UPDATE alert_results AS alert
SET product_id = record.product_id
FROM daily_records AS record
WHERE alert.daily_record_id = record.id
  AND alert.product_id IS NULL;
UPDATE alert_results AS alert
SET product_id = agent.product_id
FROM agents AS agent
WHERE alert.agent_id = agent.id
  AND alert.product_id IS NULL;
UPDATE alert_results
SET product_id = (SELECT id FROM products WHERE name = '默认产品' LIMIT 1)
WHERE product_id IS NULL;
ALTER TABLE alert_results ALTER COLUMN product_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alert_results_product_id_fkey'
  ) THEN
    ALTER TABLE alert_results
      ADD CONSTRAINT alert_results_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS cost_dod NUMERIC(12, 4);
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS activations_dod NUMERIC(12, 4);
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS cost_wow NUMERIC(12, 4);
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS activations_wow NUMERIC(12, 4);
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS is_cost_alert BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS is_activations_alert BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_agents_product ON agents(product_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_product ON daily_records(product_id);
CREATE INDEX IF NOT EXISTS idx_daily_records_lookup ON daily_records(product_id, agent_id, channel_id, creative_type, record_date);
CREATE INDEX IF NOT EXISTS idx_target_changes_lookup ON target_changes(product_id, agent_id, channel_id, creative_type, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_alert_results_product ON alert_results(product_id);
