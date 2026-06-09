export const DEFAULT_CREATIVE_TYPES = ['单本', '短剧', '动态漫', '仿真人', '有声', '红包', '影游'];
export const DEFAULT_PROMOTION_GOALS = ['拉新', '卸载', '拉活'];
export const DEFAULT_PROMOTION_GOAL = '拉新';

export interface AuthorizedScopeInput {
  creative_type?: unknown;
  promotion_goal?: unknown;
  is_active?: unknown;
}

export function normalizeCreativeTypes(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => String(item || '').split(/[、,，/|；;\n\r\t]+/))
    : String(value || '').split(/[、,，/|；;\n\r\t]+/);

  return Array.from(new Set(
    rawValues
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

export function normalizePromotionGoals(value: unknown): string[] {
  return normalizeCreativeTypes(value);
}

export function normalizeDictionaryName(value: unknown) {
  return String(value || '').trim();
}

export function normalizeAuthorizedScopes(
  value: unknown,
  fallbackCreativeTypes: unknown = []
) {
  const rows = Array.isArray(value) ? value as AuthorizedScopeInput[] : [];
  const scoped = rows
    .map((item) => ({
      creative_type: normalizeDictionaryName(item?.creative_type),
      promotion_goal: normalizeDictionaryName(item?.promotion_goal) || DEFAULT_PROMOTION_GOAL,
      is_active: item?.is_active === undefined ? true : Boolean(item.is_active),
    }))
    .filter((item) => item.creative_type && item.promotion_goal);

  const fallback = normalizeCreativeTypes(fallbackCreativeTypes).map((creativeType) => ({
    creative_type: creativeType,
    promotion_goal: DEFAULT_PROMOTION_GOAL,
    is_active: true,
  }));

  const deduped = new Map<string, { creative_type: string; promotion_goal: string; is_active: boolean }>();
  for (const item of [...scoped, ...fallback]) {
    const key = `${item.creative_type}\n${item.promotion_goal}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    } else if (item.is_active) {
      deduped.set(key, { ...deduped.get(key)!, is_active: true });
    }
  }

  return Array.from(deduped.values()).sort((left, right) => (
    left.creative_type.localeCompare(right.creative_type, 'zh-Hans-CN') ||
    left.promotion_goal.localeCompare(right.promotion_goal, 'zh-Hans-CN')
  ));
}

export function creativeTypesLabel(value: unknown) {
  const types = normalizeCreativeTypes(value);
  return types.length > 0 ? types.join('、') : '';
}

export function authorizedScopesLabel(value: unknown) {
  const scopes = normalizeAuthorizedScopes(value);
  return scopes.length > 0
    ? scopes.map((item) => `${item.creative_type}+${item.promotion_goal}`).join('、')
    : '';
}
