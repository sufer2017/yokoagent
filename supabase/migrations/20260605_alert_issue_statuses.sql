-- YokoAgent per-issue status migration for daily report highlights.
-- Run once before deploying the issue-level alert handling code.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS alert_issue_statuses (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_result_id   UUID NOT NULL REFERENCES alert_results(id) ON DELETE CASCADE,
    issue_key         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (alert_result_id, issue_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_issue_statuses_alert ON alert_issue_statuses(alert_result_id);
CREATE INDEX IF NOT EXISTS idx_alert_issue_statuses_status ON alert_issue_statuses(status);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alert_issue_statuses_updated ON alert_issue_statuses;
CREATE TRIGGER trg_alert_issue_statuses_updated
BEFORE UPDATE ON alert_issue_statuses
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
