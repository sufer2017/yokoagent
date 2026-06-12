-- Alert threshold settings for admin-configured site alerts.
CREATE TABLE IF NOT EXISTS alert_threshold_settings (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    channel_id       UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    creative_type    TEXT NOT NULL,
    metric_key       TEXT NOT NULL CHECK (metric_key IN (
        'cost_dod',
        'cost_wow',
        'activations_dod',
        'activations_wow',
        'cpa_target_deviation',
        'cpa_dod',
        'cpa_wow',
        'retention_day1_dod',
        'retention_day1_wow',
        'retention_day1_target_deviation',
        'retention_day7_dod',
        'retention_day7_wow',
        'retention_day7_target_deviation'
    )),
    upper_threshold  NUMERIC(12, 4) CHECK (upper_threshold IS NULL OR upper_threshold >= 0),
    lower_threshold  NUMERIC(12, 4) CHECK (lower_threshold IS NULL OR lower_threshold >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT alert_threshold_settings_scope_metric_key UNIQUE (product_id, channel_id, creative_type, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_threshold_settings_scope
  ON alert_threshold_settings(product_id, channel_id, creative_type);

DROP TRIGGER IF EXISTS trg_alert_threshold_settings_updated ON alert_threshold_settings;
CREATE TRIGGER trg_alert_threshold_settings_updated
  BEFORE UPDATE ON alert_threshold_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
