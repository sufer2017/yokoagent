import type { Constraint, DailyRecordView } from '@/types/database';
import type { ConstraintViolation } from '@/types/api';
import { computeActivationCost } from './formatters';

/**
 * Get the metric value from a record for constraint evaluation.
 */
function getMetricValue(record: DailyRecordView, metric: string): number | null {
  switch (metric) {
    case 'activation_cost':
      return computeActivationCost(record.cost, record.activations);
    case 'activations':
      return record.activations;
    case 'retention_day1':
      return record.retention_day1;
    case 'retention_day7':
      return record.retention_day7;
    case 'cost':
      return record.cost;
    default:
      return null;
  }
}

/**
 * Evaluate a single constraint against a metric value.
 */
function evaluateConstraint(
  actualValue: number,
  operator: string,
  threshold: number
): boolean {
  switch (operator) {
    case '<=': return actualValue <= threshold;
    case '>=': return actualValue >= threshold;
    case '<':  return actualValue < threshold;
    case '>':  return actualValue > threshold;
    case '=':  return actualValue === threshold;
    default:   return true;
  }
}

/**
 * Check a single record against all active constraints.
 * Returns an array of violations (empty if all pass).
 */
export function checkRecordViolations(
  record: DailyRecordView,
  constraints: Constraint[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const constraint of constraints) {
    if (!constraint.is_active) continue;

    const actualValue = getMetricValue(record, constraint.metric);
    if (actualValue == null) continue;

    const passes = evaluateConstraint(actualValue, constraint.operator, constraint.value);
    if (!passes) {
      violations.push({
        record_id: record.id,
        record_date: record.record_date,
        agent_name: record.agent_name || '',
        channel_name: record.channel_name || '',
        project_name: record.project_name || '',
        constraint_name: constraint.name,
        constraint_metric: constraint.metric,
        constraint_operator: constraint.operator,
        constraint_value: constraint.value,
        actual_value: actualValue,
      });
    }
  }

  return violations;
}
