/**
 * Format a number as currency (CNY).
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '-';
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a number as percentage.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value.toFixed(2)}%`;
}

/**
 * Safely divide two numbers, returns null if divisor is 0.
 */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Compute activation cost = cost / activations.
 */
export function computeActivationCost(cost: number, activations: number): number | null {
  return safeDivide(cost, activations);
}
