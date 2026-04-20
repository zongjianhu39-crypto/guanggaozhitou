const PRIMARY_DATA_YEAR = '2026';
const REFERENCE_DATA_YEAR = '2025';

export const DATA_SOURCE_CONFIG = {
  primaryDataYear: PRIMARY_DATA_YEAR,
  referenceDataYear: REFERENCE_DATA_YEAR,
  tables: {
    plans: 'ad_plans',
    activities: 'ad_plan_activities',
    agentActual: `live_ad_agent_${PRIMARY_DATA_YEAR}`,
    shortLiveLink: `short_live_link_${PRIMARY_DATA_YEAR}`,
    referenceFinancial: `financial_${REFERENCE_DATA_YEAR}`,
    referenceTaobaoLive: `taobao_live_${REFERENCE_DATA_YEAR}`,
  },
  superLive: {
    annualDateColumn: '日期',
    monthlyDateColumn: '日期',
    amountColumn: '花费',
    viewsColumn: '观看次数',
    ordersColumn: '总成交笔数',
    cartColumn: '总购物车数',
    preOrdersColumn: '总预售成交笔数',
  },
  agentActual: {
    dateColumn: '日期',
    amountColumn: 'amount',
    select: '日期,amount',
  },
  shortLiveLink: {
    dateColumn: '日期',
    amountColumn: '花费',
    select: '日期,花费',
  },
  referenceFinancial: {
    dateColumn: '日期',
    guaranteeCommissionColumn: '保量佣金',
    estimatedAgencyCommissionColumn: '预估结算机构佣金',
    brandFeeColumn: '品牌费',
    select: '日期,保量佣金,预估结算机构佣金,品牌费',
  },
  referenceTaobaoLive: {
    dateColumn: '日期',
    buyersColumn: '成交人数',
    ordersColumn: '成交笔数',
    select: '日期,成交人数,成交笔数',
  },
  reference: {
    year: REFERENCE_DATA_YEAR,
    outputField: `reference_${REFERENCE_DATA_YEAR}_amount`,
  },
} as const;

type Row = Record<string, unknown>;

export type PlanDashboardSummaryInput = {
  start: string;
  end: string;
  plans: Row[];
  activities: Row[];
  wanxiangRows: Row[];
  agentRows: Row[];
  referenceAgentRows: Row[];
  shortLiveLinkRows: Row[];
  referenceRows: Row[];
  referenceFinancialRows: Row[];
  referenceTaobaoLiveRows: Row[];
};

export function isValidDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function enumerateDates(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function toNum(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseDateValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function withYear(isoDate: string, year: string) {
  const [, month, day] = isoDate.split('-');
  return `${year}-${month}-${day}`;
}

export function getReferenceDates(dates: string[], referenceYear = DATA_SOURCE_CONFIG.reference.year) {
  return dates.map((date) => withYear(date, referenceYear));
}

export function normalizePlanPatch(patch: Row) {
  const normalized: Row = {};
  if ('wanxiang_plan' in patch) normalized.wanxiang_plan = toNum(patch.wanxiang_plan);
  if ('agent_plan' in patch) normalized.agent_plan = toNum(patch.agent_plan);
  if ('activity_override' in patch) normalized.activity_override = String(patch.activity_override || '').trim() || null;
  if ('remark' in patch) normalized.remark = String(patch.remark || '').trim() || null;
  return normalized;
}

function sumRowsByDate(rows: Row[], dateColumnCandidates: string[], amountColumn: string) {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const rawDate = dateColumnCandidates.map((column) => row[column]).find(Boolean);
    const day = parseDateValue(rawDate);
    if (!day) continue;
    byDate.set(day, (byDate.get(day) || 0) + toNum(row[amountColumn]));
  }
  return byDate;
}

function buildActivityByDate(activities: Row[], start: string, end: string) {
  const activityByDate = new Map<string, Row>();
  for (const activity of activities) {
    const activityStart = String(activity.start_date);
    const activityEnd = String(activity.end_date);
    for (const day of enumerateDates(activityStart, activityEnd)) {
      if (day < start || day > end) continue;
      if (!activityByDate.has(day)) activityByDate.set(day, activity);
    }
  }
  return activityByDate;
}

export function buildPlanDashboardSummary(input: PlanDashboardSummaryInput) {
  const {
    start,
    end,
    plans,
    activities,
    wanxiangRows,
    agentRows,
    referenceAgentRows,
    shortLiveLinkRows,
    referenceRows,
    referenceFinancialRows,
    referenceTaobaoLiveRows,
  } = input;
  const dates = enumerateDates(start, end);
  const plansByDate = new Map(plans.map((row) => [String(row.plan_date), row]));
  const activityByDate = buildActivityByDate(activities, start, end);

  const superLiveDateCols = [DATA_SOURCE_CONFIG.superLive.monthlyDateColumn, DATA_SOURCE_CONFIG.superLive.annualDateColumn];
  const wanxiangCostByDate = sumRowsByDate(wanxiangRows, superLiveDateCols, DATA_SOURCE_CONFIG.superLive.amountColumn);
  const agentCostByDate = sumRowsByDate(agentRows, [DATA_SOURCE_CONFIG.agentActual.dateColumn], DATA_SOURCE_CONFIG.agentActual.amountColumn);
  const referenceAgentCostByDate = sumRowsByDate(referenceAgentRows, [DATA_SOURCE_CONFIG.agentActual.dateColumn], DATA_SOURCE_CONFIG.agentActual.amountColumn);
  const shortLiveLinkCostByDate = sumRowsByDate(shortLiveLinkRows, [DATA_SOURCE_CONFIG.shortLiveLink.dateColumn], DATA_SOURCE_CONFIG.shortLiveLink.amountColumn);

  const refDateCols = [DATA_SOURCE_CONFIG.superLive.annualDateColumn, DATA_SOURCE_CONFIG.superLive.monthlyDateColumn];
  const referenceByDate = sumRowsByDate(referenceRows, refDateCols, DATA_SOURCE_CONFIG.superLive.amountColumn);
  const referenceViewsByDate = sumRowsByDate(referenceRows, refDateCols, DATA_SOURCE_CONFIG.superLive.viewsColumn);
  const referenceOrdersByDate = sumRowsByDate(referenceRows, refDateCols, DATA_SOURCE_CONFIG.superLive.ordersColumn);
  const referenceCartByDate = sumRowsByDate(referenceRows, refDateCols, DATA_SOURCE_CONFIG.superLive.cartColumn);
  const referencePreOrdersByDate = sumRowsByDate(referenceRows, refDateCols, DATA_SOURCE_CONFIG.superLive.preOrdersColumn);

  const financialDateCols = [DATA_SOURCE_CONFIG.referenceFinancial.dateColumn];
  const referenceGuaranteeByDate = sumRowsByDate(referenceFinancialRows, financialDateCols, DATA_SOURCE_CONFIG.referenceFinancial.guaranteeCommissionColumn);
  const referenceEstimatedAgencyByDate = sumRowsByDate(referenceFinancialRows, financialDateCols, DATA_SOURCE_CONFIG.referenceFinancial.estimatedAgencyCommissionColumn);
  const referenceBrandFeeByDate = sumRowsByDate(referenceFinancialRows, financialDateCols, DATA_SOURCE_CONFIG.referenceFinancial.brandFeeColumn);

  const taobaoDateCols = [DATA_SOURCE_CONFIG.referenceTaobaoLive.dateColumn];
  const referenceBuyersByDate = sumRowsByDate(referenceTaobaoLiveRows, taobaoDateCols, DATA_SOURCE_CONFIG.referenceTaobaoLive.buyersColumn);
  const referenceTaobaoOrdersByDate = sumRowsByDate(referenceTaobaoLiveRows, taobaoDateCols, DATA_SOURCE_CONFIG.referenceTaobaoLive.ordersColumn);

  const days = dates.map((date) => {
    const plan = plansByDate.get(date);
    const activity = activityByDate.get(date);
    const wanxiangPlan = toNum(plan?.wanxiang_plan);
    const agentPlan = toNum(plan?.agent_plan);
    const totalPlan = wanxiangPlan + agentPlan;
    const wanxiangActual = wanxiangCostByDate.get(date) || 0;
    const agentActualForDate = agentCostByDate.get(date);
    const agentActual = agentActualForDate || 0;
    const shortLiveLinkActual = shortLiveLinkCostByDate.get(date) || 0;
    const actualCost = wanxiangActual + agentActual + shortLiveLinkActual;
    const referenceDate = withYear(date, DATA_SOURCE_CONFIG.reference.year);
    const referenceAgentAmount = referenceAgentCostByDate.get(referenceDate);
    const referenceAmount = referenceByDate.get(referenceDate) || 0;
    const resolvedActivity = String(plan?.activity_override || activity?.activity_name || '');
    const activitySource = plan?.activity_override ? 'override' : (activity ? 'activity' : 'none');

    return {
      date,
      wanxiang_plan: wanxiangPlan,
      agent_plan: agentPlan,
      total_plan_amount: totalPlan,
      activity: resolvedActivity,
      activity_source: activitySource,
      activity_id: activity?.id || null,
      activity_type: activity?.activity_type || null,
      activity_start_date: activity?.start_date || null,
      activity_end_date: activity?.end_date || null,
      agent_amount: referenceAgentAmount ?? null,
      actual_cost: actualCost,
      completion_rate: totalPlan > 0 ? actualCost / totalPlan : null,
      reference_amount: referenceAmount,
      reference_views: referenceViewsByDate.get(referenceDate) || 0,
      reference_orders: referenceOrdersByDate.get(referenceDate) || 0,
      reference_cart: referenceCartByDate.get(referenceDate) || 0,
      reference_pre_orders: referencePreOrdersByDate.get(referenceDate) || 0,
      reference_buyers: referenceBuyersByDate.get(referenceDate) || 0,
      reference_taobao_orders: referenceTaobaoOrdersByDate.get(referenceDate) || 0,
      reference_financial_guarantee_commission: referenceGuaranteeByDate.get(referenceDate) || 0,
      reference_financial_estimated_agency_commission: referenceEstimatedAgencyByDate.get(referenceDate) || 0,
      reference_financial_brand_fee: referenceBrandFeeByDate.get(referenceDate) || 0,
      remark: String(plan?.remark || ''),
      updated_by: plan?.updated_by || null,
      updated_at: plan?.updated_at || null,
    };
  });

  const kpis = days.reduce((acc, row) => {
    acc.total_wanxiang_plan += row.wanxiang_plan;
    acc.total_agent_plan += row.agent_plan;
    acc.total_plan_amount += row.total_plan_amount;
    acc.total_actual_cost += row.actual_cost;
    return acc;
  }, {
    total_wanxiang_plan: 0,
    total_agent_plan: 0,
    total_plan_amount: 0,
    total_actual_cost: 0,
    overall_completion_rate: null as number | null,
  });
  kpis.overall_completion_rate = kpis.total_plan_amount > 0 ? kpis.total_actual_cost / kpis.total_plan_amount : null;

  return { range: { start, end }, kpis, days, activities };
}
