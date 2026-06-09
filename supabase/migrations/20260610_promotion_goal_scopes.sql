BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS creative_types (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_goals (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO creative_types(name) VALUES
    ('单本'), ('短剧'), ('动态漫'), ('仿真人'), ('有声'), ('红包'), ('影游')
ON CONFLICT (name) DO UPDATE SET is_active = true, updated_at = now();

INSERT INTO promotion_goals(name) VALUES
    ('拉新'), ('卸载'), ('拉活')
ON CONFLICT (name) DO UPDATE SET is_active = true, updated_at = now();

CREATE INDEX IF NOT EXISTS idx_creative_types_active ON creative_types(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_promotion_goals_active ON promotion_goals(is_active) WHERE is_active = true;

ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS promotion_goal TEXT NOT NULL DEFAULT '拉新';
ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS promotion_goal TEXT NOT NULL DEFAULT '拉新';
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS promotion_goal TEXT NOT NULL DEFAULT '拉新';

UPDATE daily_records SET creative_type = btrim(creative_type), promotion_goal = '拉新';
UPDATE target_changes SET creative_type = btrim(creative_type), promotion_goal = '拉新';
UPDATE alert_results SET creative_type = btrim(creative_type), promotion_goal = '拉新';

DELETE FROM daily_records
WHERE creative_type NOT IN ('单本', '短剧', '动态漫', '仿真人', '有声', '红包', '影游');

DELETE FROM alert_results
WHERE creative_type NOT IN ('单本', '短剧', '动态漫', '仿真人', '有声', '红包', '影游');

DELETE FROM target_changes
WHERE creative_type NOT IN ('单本', '短剧', '动态漫', '仿真人', '有声', '红包', '影游');

DELETE FROM alert_issue_statuses
WHERE NOT EXISTS (
    SELECT 1 FROM alert_results WHERE alert_results.id = alert_issue_statuses.alert_result_id
);

CREATE TABLE IF NOT EXISTS agent_authorized_scopes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    creative_type   TEXT NOT NULL,
    promotion_goal  TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_authorized_scopes_agent_creative_goal_key UNIQUE (agent_id, creative_type, promotion_goal)
);

CREATE INDEX IF NOT EXISTS idx_agent_authorized_scopes_agent ON agent_authorized_scopes(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_authorized_scopes_active ON agent_authorized_scopes(agent_id, is_active) WHERE is_active = true;

INSERT INTO agent_authorized_scopes(agent_id, creative_type, promotion_goal, is_active)
SELECT agents.id, btrim(creative_type), '拉新', true
FROM agents
CROSS JOIN LATERAL unnest(agents.creative_types) AS creative_type
WHERE btrim(creative_type) IN ('单本', '短剧', '动态漫', '仿真人', '有声', '红包', '影游')
ON CONFLICT (agent_id, creative_type, promotion_goal)
DO UPDATE SET is_active = true, updated_at = now();

INSERT INTO agent_authorized_scopes(agent_id, creative_type, promotion_goal, is_active)
SELECT DISTINCT agent_id, creative_type, '拉新', true
FROM daily_records
WHERE creative_type IN ('单本', '短剧', '动态漫', '仿真人', '有声', '红包', '影游')
ON CONFLICT (agent_id, creative_type, promotion_goal)
DO UPDATE SET is_active = true, updated_at = now();

UPDATE agents
SET creative_types = COALESCE((
        SELECT array_agg(DISTINCT creative_type ORDER BY creative_type)
        FROM agent_authorized_scopes
        WHERE agent_authorized_scopes.agent_id = agents.id
          AND agent_authorized_scopes.is_active = true
    ), '{}'),
    updated_at = now();

ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_product_id_agent_id_channel_id_record_date_creative_type_key;
ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_agent_id_channel_id_record_date_creative_type_key;
ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_agent_id_record_date_creative_type_key;
ALTER TABLE daily_records DROP CONSTRAINT IF EXISTS daily_records_scope_goal_key;
ALTER TABLE daily_records
  ADD CONSTRAINT daily_records_scope_goal_key
  UNIQUE (product_id, agent_id, channel_id, record_date, creative_type, promotion_goal);

ALTER TABLE target_changes DROP CONSTRAINT IF EXISTS target_changes_product_id_agent_id_channel_id_creative_type_effective_date_key;
ALTER TABLE target_changes DROP CONSTRAINT IF EXISTS target_changes_agent_id_channel_id_effective_date_key;
ALTER TABLE target_changes DROP CONSTRAINT IF EXISTS target_changes_agent_id_effective_date_key;
ALTER TABLE target_changes DROP CONSTRAINT IF EXISTS target_changes_scope_goal_date_key;
ALTER TABLE target_changes
  ADD CONSTRAINT target_changes_scope_goal_date_key
  UNIQUE (product_id, agent_id, channel_id, creative_type, promotion_goal, effective_date);

DROP INDEX IF EXISTS idx_daily_records_lookup;
DROP INDEX IF EXISTS idx_target_changes_lookup;
CREATE INDEX idx_daily_records_lookup ON daily_records(product_id, agent_id, channel_id, creative_type, promotion_goal, record_date);
CREATE INDEX idx_target_changes_lookup ON target_changes(product_id, agent_id, channel_id, creative_type, promotion_goal, effective_date DESC);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_creative_types_updated ON creative_types;
DROP TRIGGER IF EXISTS trg_promotion_goals_updated ON promotion_goals;
DROP TRIGGER IF EXISTS trg_agent_authorized_scopes_updated ON agent_authorized_scopes;
CREATE TRIGGER trg_creative_types_updated BEFORE UPDATE ON creative_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_promotion_goals_updated BEFORE UPDATE ON promotion_goals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_agent_authorized_scopes_updated BEFORE UPDATE ON agent_authorized_scopes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
