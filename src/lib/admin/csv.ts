export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

export function parseCsv(text: string, aliases: Record<string, string> = {}): ParsedCsv {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map((header) => aliases[header] || header);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index] || '';
      return row;
    }, {});
  });

  return { headers, rows };
}

export function csvResponse(filename: string, headers: string[], sampleRows: string[][] = []) {
  const body = [
    headers.join(','),
    ...sampleRows.map((row) => row.map(escapeCsvCell).join(',')),
  ].join('\n');

  return new Response(`\uFEFF${body}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}

export function escapeCsvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function normalizeNumber(value: string | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/%/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const next = Number(cleaned);
  return Number.isFinite(next) ? next : null;
}

export function parseBoolean(value: string | undefined, defaultValue = true) {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['是', '启用', '在投', 'true', '1', 'yes', 'y', 'active'].includes(normalized)) return true;
  if (['否', '停用', '不在投', 'false', '0', 'no', 'n', 'inactive'].includes(normalized)) return false;
  return null;
}

export function isYmdDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
}

export function missingHeaders(headers: string[], required: string[]) {
  return required.filter((header) => !headers.includes(header));
}
