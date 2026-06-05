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

export function creativeTypesLabel(value: unknown) {
  const types = normalizeCreativeTypes(value);
  return types.length > 0 ? types.join('、') : '';
}
