/**
 * super_live 表路由规则（2026 年起重要变更）：
 * - 2025 年：统一使用单张大表 super_live_2025
 * - 2026 年及以后：按月分表，格式为 super_live_YYYYMM（例如 super_live_202601）
 *
 * 此函数已优化为通用逻辑，支持未来任意年份，无需再硬编码。
 */
export type RoutedTable = {
  table: string;
  dates: string[];
};

function dateToYear(date: string): string {
  return String(date || '').slice(0, 4);
}

function dateToMonthKey(date: string): string {
  return String(date || '').slice(0, 7);
}

function enumerateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function groupDatesByTable(dates: string[], getTable: (date: string) => string): RoutedTable[] {
  const tableDates = new Map<string, string[]>();
  dates.forEach((date) => {
    const table = getTable(date);
    const existing = tableDates.get(table) ?? [];
    existing.push(date);
    tableDates.set(table, existing);
  });

  return [...tableDates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, tableDateList]) => ({ table, dates: tableDateList }));
}

export function getDateRangeDates(startDate: string, endDate: string): string[] {
  return enumerateDateRange(startDate, endDate);
}

export function getAnnualTablesForDateRange(prefix: string, startDate: string, endDate: string): RoutedTable[] {
  return groupDatesByTable(enumerateDateRange(startDate, endDate), (date) => `${prefix}_${dateToYear(date)}`);
}

export function getFinancialTablesForDateRange(startDate: string, endDate: string): RoutedTable[] {
  return getAnnualTablesForDateRange('financial', startDate, endDate);
}

export function getTaobaoLiveTablesForDateRange(startDate: string, endDate: string): RoutedTable[] {
  return getAnnualTablesForDateRange('taobao_live', startDate, endDate);
}

export function getSingleProductAdTablesForDateRange(startDate: string, endDate: string): RoutedTable[] {
  return getAnnualTablesForDateRange('single_product_ad', startDate, endDate);
}

function getSuperLiveTableName(date: string): string {
  const year = dateToYear(date);
  if (year === '2025') {
    return 'super_live_2025';
  }
  return `super_live_${dateToMonthKey(date).replace('-', '')}`;
}

export function getSuperLiveTablesForDateRange(startDate: string, endDate: string): RoutedTable[] {
  return groupDatesByTable(enumerateDateRange(startDate, endDate), getSuperLiveTableName);
}

export function getSuperLiveTablesForDates(dates: string[]): RoutedTable[] {
  return groupDatesByTable(dates, getSuperLiveTableName);
}
