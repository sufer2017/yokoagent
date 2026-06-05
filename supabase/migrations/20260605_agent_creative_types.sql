-- Add multi-value creative type binding to agent accounts.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS creative_types TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_agents_creative_types ON agents USING GIN (creative_types);

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
