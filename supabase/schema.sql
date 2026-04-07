-- ============================================================
-- YokoAgent Database Schema
-- Run this in Supabase SQL Editor after creating project
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. agents
-- ============================================================
CREATE TABLE agents (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agents_name ON agents(name);
CREATE INDEX idx_agents_active ON agents(is_active) WHERE is_active = true;

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

-- ============================================================
-- 3. projects
-- ============================================================
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. daily_records
-- ============================================================
CREATE TABLE daily_records (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    record_date     DATE NOT NULL,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    cost            NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    activations     INTEGER NOT NULL DEFAULT 0 CHECK (activations >= 0),
    retention_day1  NUMERIC(5, 2) CHECK (retention_day1 >= 0 AND retention_day1 <= 100),
    retention_day7  NUMERIC(5, 2) CHECK (retention_day7 >= 0 AND retention_day7 <= 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, record_date, channel_id, project_id)
);

CREATE INDEX idx_daily_records_agent ON daily_records(agent_id);
CREATE INDEX idx_daily_records_date ON daily_records(record_date);
CREATE INDEX idx_daily_records_channel ON daily_records(channel_id);
CREATE INDEX idx_daily_records_agent_date ON daily_records(agent_id, record_date);

-- ============================================================
-- 5. channel_budgets
-- ============================================================
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

-- ============================================================
-- 6. agent_channel_allocations
-- ============================================================
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

CREATE INDEX idx_allocations_agent ON agent_channel_allocations(agent_id);

-- ============================================================
-- 7. constraints
-- ============================================================
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

CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_channels_updated BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_daily_records_updated BEFORE UPDATE ON daily_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_channel_budgets_updated BEFORE UPDATE ON channel_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_allocations_updated BEFORE UPDATE ON agent_channel_allocations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_constraints_updated BEFORE UPDATE ON constraints FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Seed: default hard constraints
-- ============================================================
INSERT INTO constraints (name, type, metric, operator, value) VALUES
    ('激活成本上限', 'hard', 'activation_cost', '<=', 999999),
    ('激活量下限',   'hard', 'activations',     '>=', 0),
    ('次日留存下限', 'hard', 'retention_day1',  '>=', 0),
    ('7日留存下限',  'hard', 'retention_day7',  '>=', 0);

-- 管理员账号使用应用内固定凭证：
-- username: admin
-- password: yzy19990704@
