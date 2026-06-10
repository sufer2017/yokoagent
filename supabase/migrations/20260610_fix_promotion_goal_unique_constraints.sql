BEGIN;

ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS promotion_goal TEXT NOT NULL DEFAULT '拉新';
ALTER TABLE target_changes ADD COLUMN IF NOT EXISTS promotion_goal TEXT NOT NULL DEFAULT '拉新';

DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT con.conname
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    CROSS JOIN LATERAL (
      SELECT array_agg(att.attname ORDER BY att.attname) AS column_names
      FROM unnest(con.conkey) AS key(attnum)
      JOIN pg_attribute AS att
        ON att.attrelid = con.conrelid
       AND att.attnum = key.attnum
    ) AS cols
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'daily_records'
      AND con.contype = 'u'
      AND NOT ('promotion_goal'::name = ANY(cols.column_names))
      AND cols.column_names <@ ARRAY['product_id', 'agent_id', 'channel_id', 'record_date', 'creative_type']::name[]
      AND cols.column_names @> ARRAY['agent_id', 'record_date', 'creative_type']::name[]
  LOOP
    EXECUTE format('ALTER TABLE public.daily_records DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    CROSS JOIN LATERAL (
      SELECT array_agg(att.attname ORDER BY att.attname) AS column_names
      FROM unnest(con.conkey) AS key(attnum)
      JOIN pg_attribute AS att
        ON att.attrelid = con.conrelid
       AND att.attnum = key.attnum
    ) AS cols
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'daily_records'
      AND con.contype = 'u'
      AND cols.column_names @> ARRAY['product_id', 'agent_id', 'channel_id', 'record_date', 'creative_type', 'promotion_goal']::name[]
      AND cols.column_names <@ ARRAY['product_id', 'agent_id', 'channel_id', 'record_date', 'creative_type', 'promotion_goal']::name[]
  ) THEN
    ALTER TABLE public.daily_records
      ADD CONSTRAINT daily_records_scope_goal_key
      UNIQUE (product_id, agent_id, channel_id, record_date, creative_type, promotion_goal);
  END IF;
END $$;

DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT con.conname
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    CROSS JOIN LATERAL (
      SELECT array_agg(att.attname ORDER BY att.attname) AS column_names
      FROM unnest(con.conkey) AS key(attnum)
      JOIN pg_attribute AS att
        ON att.attrelid = con.conrelid
       AND att.attnum = key.attnum
    ) AS cols
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'target_changes'
      AND con.contype = 'u'
      AND NOT ('promotion_goal'::name = ANY(cols.column_names))
      AND cols.column_names <@ ARRAY['product_id', 'agent_id', 'channel_id', 'creative_type', 'effective_date']::name[]
      AND cols.column_names @> ARRAY['agent_id', 'effective_date']::name[]
  LOOP
    EXECUTE format('ALTER TABLE public.target_changes DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    CROSS JOIN LATERAL (
      SELECT array_agg(att.attname ORDER BY att.attname) AS column_names
      FROM unnest(con.conkey) AS key(attnum)
      JOIN pg_attribute AS att
        ON att.attrelid = con.conrelid
       AND att.attnum = key.attnum
    ) AS cols
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'target_changes'
      AND con.contype = 'u'
      AND cols.column_names @> ARRAY['product_id', 'agent_id', 'channel_id', 'creative_type', 'promotion_goal', 'effective_date']::name[]
      AND cols.column_names <@ ARRAY['product_id', 'agent_id', 'channel_id', 'creative_type', 'promotion_goal', 'effective_date']::name[]
  ) THEN
    ALTER TABLE public.target_changes
      ADD CONSTRAINT target_changes_scope_goal_date_key
      UNIQUE (product_id, agent_id, channel_id, creative_type, promotion_goal, effective_date);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_daily_records_lookup;
DROP INDEX IF EXISTS idx_target_changes_lookup;
CREATE INDEX idx_daily_records_lookup ON daily_records(product_id, agent_id, channel_id, creative_type, promotion_goal, record_date);
CREATE INDEX idx_target_changes_lookup ON target_changes(product_id, agent_id, channel_id, creative_type, promotion_goal, effective_date DESC);

COMMIT;
