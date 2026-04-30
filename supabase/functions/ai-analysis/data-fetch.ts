import { debugLog } from '../_shared/logger.ts';
import type { RoutedTable } from '../_shared/table-routes.ts';
import type { DataRow } from './analysis-types.ts';
import { getSupabaseHeaders, SB_URL } from './supabase-rest.ts';

const DATE_COLUMN = '日期';
export const AI_SUPER_LIVE_COLUMNS = [
  '日期',
  '花费',
  '总成交金额',
  '总成交笔数',
  '观看次数',
  '展现量',
  '直接成交金额',
  '总购物车数',
  '总预售成交笔数',
  '互动量',
  '人群名字',
];
export const AI_FINANCIAL_COLUMNS = [
  '日期',
  '业务口径收入',
  '支付gmv',
  '成本合计',
  '毛利',
  '流量投放',
  '保量佣金',
  '预估结算线下佣金',
  '预估结算机构佣金',
  '宣传费用',
  '现场费用',
  '抽奖及打赏',
  '物品补贴',
  '艺人成本',
  '内部主播成本',
  '直播间红包',
  '严选红包',
];
export const AI_TAOBAO_LIVE_COLUMNS = [
  '日期',
  '场次信息',
  '观看人数',
  '成交金额',
  '成交笔数',
  '成交人数',
  '退款金额',
];

/** 从 Supabase REST API 按 日期 范围读取数据（带分页） */
async function fetchTableData(
  table: string,
  selectColumns: string[],
  startDate: string,
  endDate: string,
): Promise<DataRow[]> {
  const allData: DataRow[] = [];
  const batchSize = 1000;
  const maxPages = 200;
  let offset = 0;
  let page = 0;

  while (page < maxPages) {
    const url = new URL(`${SB_URL}/rest/v1/${table}`);
    url.searchParams.set('select', selectColumns.join(','));
    url.searchParams.set(DATE_COLUMN, `gte.${startDate}`);
    url.searchParams.append(DATE_COLUMN, `lte.${endDate}`);
    url.searchParams.set('limit', String(batchSize));
    url.searchParams.set('offset', String(offset));
    debugLog(`[ai-analysis] Fetching ${table} ${DATE_COLUMN}=gte.${startDate}&${DATE_COLUMN}=lte.${endDate} page=${page + 1} offset=${offset}`);

    const resp = await fetch(url.toString(), {
      headers: getSupabaseHeaders(),
    });
    const respText = await resp.text();

    debugLog(`[ai-analysis] ${table} resp status=${resp.status}`);
    if (!resp.ok) {
      if (resp.status === 404) {
        console.warn(`[ai-analysis] 表 ${table} 不存在，按空表处理。body=${respText}`);
        break;
      }
      console.error(`[ai-analysis] 查询表 ${table} 失败: ${resp.status} ${respText}`);
      throw new Error(`查询表 ${table} 失败: ${resp.status} ${respText}`);
    }

    let data: DataRow[] = [];
    try {
      data = respText ? JSON.parse(respText) : [];
    } catch (error) {
      console.error(`[ai-analysis] ${table} JSON 解析失败: ${respText}`);
      throw new Error(
        `[${table}] JSON parse failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    debugLog(`[ai-analysis] ${table} 批次行数: ${data.length}`);
    allData.push(...data);

    if (data.length === 0 || data.length < batchSize) {
      break;
    }

    offset += batchSize;
    page += 1;
  }

  if (page >= maxPages) {
    throw new Error(`查询表 ${table} 超过最大分页限制 ${maxPages}，已中止以避免死循环`);
  }

  return allData;
}

export async function fetchRoutedTables(routedTables: RoutedTable[], selectColumns: string[]): Promise<DataRow[]> {
  if (!routedTables.length) return [];
  const results = await Promise.all(
    routedTables.map(async ({ table, dates }) => {
      const sortedDates = [...dates].sort();
      const rangeStart = sortedDates[0];
      const rangeEnd = sortedDates[sortedDates.length - 1];
      const startedAt = Date.now();
      const rows = await fetchTableData(table, selectColumns, rangeStart, rangeEnd);
      debugLog(`[ai-analysis] ${table} range rows=${rows.length} duration_ms=${Date.now() - startedAt}`);
      return rows;
    }),
  );
  return results.flat();
}

/** 对分页结果再按 日期 做一次收口过滤，日期列来自 Supabase date 类型。 */
export function filterByDateRange(data: DataRow[], startDate: string, endDate: string): DataRow[] {
  return data.filter((r) => {
    const d = typeof r?.[DATE_COLUMN] === 'string' ? r[DATE_COLUMN].trim() : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= startDate && d <= endDate;
  });
}
