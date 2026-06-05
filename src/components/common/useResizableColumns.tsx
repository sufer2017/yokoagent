'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type AnyColumn = {
  key?: React.Key;
  dataIndex?: React.Key | React.Key[];
  title?: unknown;
  width?: number | string;
  children?: AnyColumn[];
  [key: string]: unknown;
};

function columnKey(column: AnyColumn, index: number) {
  if (column.key != null) return String(column.key);
  if (Array.isArray(column.dataIndex)) return column.dataIndex.join('.');
  if (column.dataIndex != null) return String(column.dataIndex);
  return `column-${index}`;
}

function numericWidth(width: number | string | undefined) {
  if (typeof width === 'number') return width;
  if (typeof width === 'string') {
    const parsed = Number(width.replace('px', ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function useResizableColumns<TColumn extends object>(
  storageKey: string,
  columns: TColumn[]
): TColumn[] {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      // localStorage may be unavailable in private contexts.
    }
  }, [storageKey, widths]);

  const startResize = useCallback((event: React.MouseEvent, key: string, currentWidth: number) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = currentWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(72, Math.round(startWidth + moveEvent.clientX - startX));
      setWidths((current) => ({ ...current, [key]: nextWidth }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return useMemo(() => columns.map((rawColumn, index) => {
    const column = rawColumn as AnyColumn;
    const key = columnKey(column, index);
    const baseWidth = numericWidth(column.width) || 120;
    const width = widths[key] || baseWidth;
    return {
      ...rawColumn,
      width,
      title: (
        <span className="resizable-column-title">
          <span>{column.title as React.ReactNode}</span>
          <span
            className="resizable-column-handle"
            onMouseDown={(event) => startResize(event, key, width)}
          />
        </span>
      ),
    } as TColumn;
  }), [columns, startResize, widths]);
}
