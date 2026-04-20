import type { GenbiRange } from './genbi-time.ts';

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function ratio(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

export function money(value: number): string {
  if (Math.abs(value) >= 10000) return `¥${(value / 10000).toFixed(2)}万`;
  return `¥${value.toFixed(0)}`;
}

export function computeChangeRate(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

export function composeTable(title: string, columns: string[], rows: Record<string, unknown>[]) {
  return { title, columns, rows };
}

export function buildAnswerEnvelope(intent: string, title: string, answer: string, range: GenbiRange | null, tables: any[] = [], highlights: string[] = [], notes: string[] = []) {
  return {
    success: true,
    intent,
    title,
    answer,
    range,
    highlights,
    tables,
    notes,
    references: [],
  };
}

export function buildUnsupportedResponse(reason: string, semanticVersion: string) {
  return {
    success: true,
    intent: 'unsupported',
    title: '当前问题暂不支持自动回答',
    answer: reason,
    range: null,
    highlights: [],
    tables: [],
    notes: [`当前是 GenBI MVP，语义层版本 ${semanticVersion}`],
    references: [],
  };
}
