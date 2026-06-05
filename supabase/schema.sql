-- ============================================================
-- YokoAgent Phase 1 Database Schema
-- Run this in Supabase SQL Editor after creating project
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. products
-- ============================================================
CREATE TABLE products (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = true;

-- ============================================================
-- 2. channels
-- ============================================================
CREATE TABLE channels (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channels_active ON channels(is_active) WHERE is_active = true;

-- ============================================================
-- 3. agents: company-level accounts
-- ============================================================
CREATE TABLE agents (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id     UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    name           TEXT NOT NULL,
    username       TEXT NOT NULL UNIQUE,
    creative_types TEXT[] NOT NULL DEFAULT '{}',
    feishu_webhook TEXT NOT NULL DEFAULT '',
    password_hash  TEXT NOT NULL,
    password_plaintext TEXT NOT NULL DEFAULT '',
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, channel_id, name)
);

CREATE INDEX idx_agents_product ON agents(product_id);
CREATE INDEX idx_agents_channel ON agents(channel_id);
CREATE INDEX idx_agents_username ON agents(username);
CREATE INDEX idx_agents_active ON agents(is_active) WHERE is_active = true;

-- Safe migration for existing Phase 1 databases.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS feishu_webhook TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS password_plaintext TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS creative_types TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_agents_creative_types ON agents USING GIN (creative_types);

-- ============================================================
-- 4. daily_records: T-1 reporting detail
-- Percent fields store percentage points, e.g. 12.3 means 12.3%.
-- ============================================================
CREATE TABLE daily_records (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    product_id        UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    record_date       DATE NOT NULL,
    creative_type     TEXT NOT NULL,
    cost              NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    activations       INTEGER NOT NULL DEFAULT 0 CHECK (activations >= 0),
    cpa               NUMERIC(12, 2) CHECK (cpa >= 0),
    ctr               NUMERIC(8, 2) CHECK (ctr >= 0 AND ctr <= 100),
    cvr               NUMERIC(8, 2) CHECK (cvr >= 0 AND cvr <= 100),
    cpm               NUMERIC(12, 2) CHECK (cpm >= 0),
    retention_day1    NUMERIC(8, 2) CHECK (retention_day1 >= 0 AND retention_day1 <= 100),
    retention_day7    NUMERIC(8, 2) CHECK (retention_day7 >= 0 AND retention_day7 <= 100),
    created_by        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, agent_id, channel_id, record_date, creative_type)
);

CREATE INDEX idx_daily_records_agent ON daily_records(agent_id);
CREATE INDEX idx_daily_records_product ON daily_records(product_id);
CREATE INDEX idx_daily_records_channel ON daily_records(channel_id);
CREATE INDEX idx_daily_records_date ON daily_records(record_date);
CREATE INDEX idx_daily_records_agent_date ON daily_records(agent_id, record_date);
CREATE INDEX idx_daily_records_date_scope ON daily_records(record_date, product_id, channel_id, agent_id);
CREATE INDEX idx_daily_records_lookup ON daily_records(product_id, agent_id, channel_id, creative_type, record_date);
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE RESTRICT;

-- ============================================================
-- 5. target_changes: assessment targets history
-- ============================================================
CREATE TABLE target_changes (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id               UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    product_id             UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    channel_id             UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    creative_type          TEXT NOT NULL,
    is_running             BOOLEAN NOT NULL DEFAULT true,
    effective_date         DATE NOT NULL,
    target_cpa             NUMERIC(12, 2) CHECK (target_cpa >= 0),
    target_retention_day1  NUMERIC(8, 2) CHECK (target_retention_day1 >= 0 AND target_retention_day1 <= 100),
    target_retention_day7  NUMERIC(8, 2) CHECK (target_retention_day7 >= 0 AND target_retention_day7 <= 100),
    activation_cap         NUMERIC(14, 2) CHECK (activation_cap >= 0),
    note                   TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, agent_id, channel_id, creative_type, effective_date)
);

CREATE INDEX idx_target_changes_lookup ON target_changes(product_id, agent_id, channel_id, creative_type, effective_date DESC);
CREATE INDEX idx_target_changes_running ON target_changes(is_running) WHERE is_running = true;
ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS creative_type TEXT NOT NULL DEFAULT '';
ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS activation_cap NUMERIC(14, 2) CHECK (activation_cap >= 0);

WITH source_creatives AS (
    SELECT agent_id, btrim(creative_type) AS creative_type
    FROM target_changes
    WHERE creative_type IS NOT NULL AND btrim(creative_type) <> ''
    UNION
    SELECT agent_id, btrim(creative_type) AS creative_type
    FROM daily_records
    WHERE creative_type IS NOT NULL AND btrim(creative_type) <> ''
),
agent_creatives AS (
    SELECT agent_id, array_agg(creative_type ORDER BY creative_type) AS creative_types
    FROM source_creatives
    GROUP BY agent_id
)
UPDATE agents
SET creative_types = agent_creatives.creative_types,
    updated_at = now()
FROM agent_creatives
WHERE agents.id = agent_creatives.agent_id
  AND (agents.creative_types IS NULL OR cardinality(agents.creative_types) = 0);

-- ============================================================
-- 6. alert_results: site alerts and computed deltas
-- ============================================================
CREATE TABLE alert_results (
    id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    daily_record_id               UUID NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
    record_date                   DATE NOT NULL,
    agent_id                      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    product_id                    UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    channel_id                    UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    creative_type                 TEXT NOT NULL,

    cost_dod                      NUMERIC(12, 4),
    activations_dod               NUMERIC(12, 4),
    cpa_dod                       NUMERIC(12, 4),
    ctr_dod                       NUMERIC(12, 4),
    cvr_dod                       NUMERIC(12, 4),
    cpm_dod                       NUMERIC(12, 4),
    retention_day1_dod            NUMERIC(12, 4),
    retention_day7_dod            NUMERIC(12, 4),

    cost_wow                      NUMERIC(12, 4),
    activations_wow               NUMERIC(12, 4),
    cpa_wow                       NUMERIC(12, 4),
    ctr_wow                       NUMERIC(12, 4),
    cvr_wow                       NUMERIC(12, 4),
    cpm_wow                       NUMERIC(12, 4),
    retention_day1_wow            NUMERIC(12, 4),
    retention_day7_wow            NUMERIC(12, 4),

    cpa_target_deviation          NUMERIC(12, 4),
    retention_day1_target_deviation NUMERIC(12, 4),
    retention_day7_target_deviation NUMERIC(12, 4),

    is_cost_alert                 BOOLEAN NOT NULL DEFAULT false,
    is_activations_alert          BOOLEAN NOT NULL DEFAULT false,
    is_cpa_alert                  BOOLEAN NOT NULL DEFAULT false,
    is_retention_day1_alert       BOOLEAN NOT NULL DEFAULT false,
    is_retention_day7_alert       BOOLEAN NOT NULL DEFAULT false,
    has_alert                     BOOLEAN NOT NULL DEFAULT false,
    alert_summary                 TEXT NOT NULL DEFAULT '无站内告警',
    status                        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_results_date ON alert_results(record_date);
CREATE INDEX idx_alert_results_agent ON alert_results(agent_id);
CREATE INDEX idx_alert_results_product ON alert_results(product_id);
CREATE INDEX idx_alert_results_channel ON alert_results(channel_id);
CREATE INDEX idx_alert_results_open ON alert_results(status, has_alert) WHERE has_alert = true;
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS is_cost_alert BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE alert_results ADD COLUMN IF NOT EXISTS is_activations_alert BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 6.1 alert_issue_statuses: per-daily-report issue handling
-- ============================================================
CREATE TABLE alert_issue_statuses (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_result_id   UUID NOT NULL REFERENCES alert_results(id) ON DELETE CASCADE,
    issue_key         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (alert_result_id, issue_key)
);

CREATE INDEX idx_alert_issue_statuses_alert ON alert_issue_statuses(alert_result_id);
CREATE INDEX idx_alert_issue_statuses_status ON alert_issue_statuses(status);

-- ============================================================
-- Legacy tables retained for older admin utilities. They are not
-- part of the phase-1 navigation.
-- ============================================================
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channel_budgets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    budget_amount   NUMERIC(12, 2) NOT NULL CHECK (budget_amount >= 0),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start),
    UNIQUE (channel_id, period_start, period_end)
);

CREATE TABLE agent_channel_allocations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_budget_id   UUID NOT NULL REFERENCES channel_budgets(id) ON DELETE CASCADE,
    agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    spending_cap        NUMERIC(12, 2) NOT NULL CHECK (spending_cap >= 0),
    activation_floor    INTEGER NOT NULL DEFAULT 0 CHECK (activation_floor >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel_budget_id, agent_id)
);

CREATE TABLE constraints (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('hard', 'custom')),
    metric      TEXT NOT NULL,
    operator    TEXT NOT NULL CHECK (operator IN ('<=', '>=', '=', '<', '>')),
    value       NUMERIC(12, 2) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Triggers: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_channels_updated BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_daily_records_updated BEFORE UPDATE ON daily_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_target_changes_updated BEFORE UPDATE ON target_changes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_alert_results_updated BEFORE UPDATE ON alert_results FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_alert_issue_statuses_updated BEFORE UPDATE ON alert_issue_statuses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_channel_budgets_updated BEFORE UPDATE ON channel_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_allocations_updated BEFORE UPDATE ON agent_channel_allocations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_constraints_updated BEFORE UPDATE ON constraints FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Seed: baseline constraints only
-- Demo accounts, 21-day reporting records, target history, and alerts
-- are initialized from the admin UI via POST /api/demo.
-- ============================================================
INSERT INTO products (name, is_active) VALUES ('默认产品', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO constraints (name, type, metric, operator, value) VALUES
    ('CPA上限', 'hard', 'cpa', '<=', 999999),
    ('激活量下限', 'hard', 'activations', '>=', 0),
    ('次留下限', 'hard', 'retention_day1', '>=', 0),
    ('7留下限', 'hard', 'retention_day7', '>=', 0);

-- 管理员账号使用应用内固定凭证：
-- username: admin
-- password: yzy19990704@

-- ============================================================
-- Data API privileges
-- The application accesses Supabase only from Next.js API routes with
-- SUPABASE_SERVICE_ROLE_KEY. Keep browser roles unprivileged.
-- ============================================================
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
