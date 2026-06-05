-- Production-scale dashboard filters for 21-day rolling windows.
CREATE INDEX IF NOT EXISTS idx_daily_records_date_scope
  ON daily_records(record_date, product_id, channel_id, agent_id);
