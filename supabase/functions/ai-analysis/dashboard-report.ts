import type { AnalysisData } from '../_shared/types.ts';
import type {
  DashboardPayloadLike,
  DailyReportResult,
  DataRow,
  ProductInsight,
  StructuredReportPayload,
} from './analysis-types.ts';
import { buildReportTitle, toNum } from './report-metrics.ts';

// 把 dashboard-data 的 payload 转成 ai-analysis 需要的 DailyReportResult（尽量保留关键字段）

function fmtNum(v: unknown, digits = 2): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(digits) : '-';
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n.toFixed(digits) : String(v);
}

function fmtPct(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `${v.toFixed(2)}%`;
  return String(v ?? '-');
}

function fmtMoney(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return n.toFixed(2);
}

// 通用：把 dashboard payload 里所有可用维度格式化成 Markdown 段落
export function buildFullDataContext(payload: DashboardPayloadLike, rankedProducts?: ProductInsight[]): string {
  const sections: string[] = [];
  const ads = payload?.ads || {};
  const kpi = ads.kpi;
  const crowdRows = payload?.crowd?.summary || [];

  // --- 汇总 KPI ---
  if (kpi) {
    sections.push([
      '## 汇总 KPI',
      `- 总花费：¥${fmtMoney(kpi.totalCost)}`,
      `- 总成交额：¥${fmtMoney(kpi.totalAmount)}`,
      `- 总订单：${fmtNum(kpi.totalOrders, 0)}`,
      `- ROI：${fmtNum(kpi.avgRoi, 2)} / 直接ROI：${fmtNum(kpi.avgDirectRoi, 2)} / 去退ROI：${fmtNum(kpi.totalReturnRoi, 2)}`,
      `- 退货率：${fmtPct(kpi.totalReturnRate)} / 观看成本：¥${fmtNum(kpi.avgViewCost, 3)} / 订单成本：¥${fmtNum(kpi.avgOrderCost, 2)}`,
      `- 广告成交占比：${fmtPct(kpi.totalAdShare)} / 千次展现成本：¥${fmtNum(kpi.avgCpm, 2)}`,
    ].join('\n'));
  }

  // --- 财务 ---
  if (kpi && (kpi.totalFinRevenue || kpi.finRevenue)) {
    sections.push([
      '## 财务数据',
      `- 收入：¥${fmtMoney(kpi.totalFinRevenue ?? kpi.finRevenue)} / 成本：¥${fmtMoney(kpi.finCost)} / 毛利：¥${fmtMoney(kpi.finProfit)} / 毛利率：${kpi.finMargin ?? '-'}`,
      `- 保量佣金：¥${fmtMoney(kpi.finGuarantee)} / 线下佣金：¥${fmtMoney(kpi.finOffline)} / 机构佣金：¥${fmtMoney(kpi.finAgency)}`,
      `- 直播间红包：¥${fmtMoney(kpi.finRedPacket)} / 严选红包：¥${fmtMoney(kpi.finYanxuanRed)}`,
    ].join('\n'));
  }

  // --- 每日趋势 ---
  if (ads.daily && ads.daily.length > 0) {
    const sorted = [...ads.daily].sort((a: DataRow, b: DataRow) => (
      String(a.label ?? '') > String(b.label ?? '') ? 1 : -1
    ));
    const lines = [
      '## 每日趋势',
      '| 日期 | 花费 | 成交额 | ROI | 直接ROI | 去退ROI | 订单 | 观看 | 观看成本 | 转化率 |',
      '|------|------|--------|-----|---------|---------|------|------|----------|--------|',
    ];
    for (const r of sorted) {
      lines.push(`| ${r.label} | ¥${fmtMoney(r.cost)} | ¥${fmtMoney(r.amount)} | ${fmtNum(r.roi, 2)} | ${fmtNum(r.directRoi, 2)} | ${fmtNum(r.returnRoi, 2)} | ${fmtNum(r.orders, 0)} | ${fmtNum(r.views, 0)} | ¥${fmtNum(r.viewCost, 3)} | ${fmtPct(r.viewConvertRate)} |`);
    }
    sections.push(lines.join('\n'));
  }

  // --- 人群分层 ---
  if (crowdRows.length > 0) {
    const lines = [
      '## 人群分层汇总',
      '| 人群分类 | 花费 | 成交额 | ROI | 直接ROI | 订单 | 观看 | 观看成本 | 转化率 |',
      '|----------|------|--------|-----|---------|------|------|----------|--------|',
    ];
    for (const c of crowdRows) {
      const s = c.summary || c;
      lines.push(`| ${c.crowd || c.label || '-'} | ¥${fmtMoney(s.cost)} | ¥${fmtMoney(s.amount)} | ${fmtNum(s.roi, 2)} | ${fmtNum(s.directRoi, 2)} | ${fmtNum(s.orders, 0)} | ${fmtNum(s.views, 0)} | ¥${fmtNum(s.viewCost, 3)} | ${fmtPct(s.viewConvertRate)} |`);
    }
    sections.push(lines.join('\n'));

    // 子人群 Top 15
    const allSubs: DataRow[] = [];
    for (const c of crowdRows) {
      for (const sub of (c.subRows || [])) {
        allSubs.push({ crowd: c.crowd || '-', ...sub });
      }
    }
    allSubs.sort((a, b) => toNum(b.cost) - toNum(a.cost));
    if (allSubs.length > 0) {
      const top = allSubs.slice(0, 15);
      const subLines = [
        '## 子人群 Top 明细（按花费排序）',
        '| 所属分类 | 子人群 | 花费 | 成交额 | ROI | 直接ROI | 订单 | 观看成本 | 转化率 |',
        '|----------|--------|------|--------|-----|---------|------|----------|--------|',
      ];
      for (const s of top) {
        subLines.push(`| ${s.crowd} | ${s.label || '-'} | ¥${fmtMoney(s.cost)} | ¥${fmtMoney(s.amount)} | ${fmtNum(s.roi, 2)} | ${fmtNum(s.directRoi, 2)} | ${fmtNum(s.orders, 0)} | ¥${fmtNum(s.viewCost, 3)} | ${fmtPct(s.viewConvertRate)} |`);
      }
      sections.push(subLines.join('\n'));
    }
  }

  // --- 单品商品明细 ---
  if (rankedProducts && rankedProducts.length > 0) {
    const lines = [
      `## 全部商品明细（${rankedProducts.length} 个商品，按花费排序）`,
      '| 商品名称 | 花费 | 占比 | 成交额 | ROI | 订单 | 加购 | 观看 | 订单成本 | 加购率 | 判断 |',
      '|----------|------|------|--------|-----|------|------|------|----------|--------|------|',
    ];
    for (const p of rankedProducts) {
      const cartRate = p.views > 0 ? ((p.carts / p.views) * 100).toFixed(1) + '%' : '-';
      const name = String(p.name || '').slice(0, 30);
      lines.push(`| ${name} | ¥${fmtMoney(p.cost)} | ${fmtNum(p.costShare, 1)}% | ¥${fmtMoney(p.amount)} | ${fmtNum(p.roi, 2)} | ${fmtNum(p.orders, 0)} | ${fmtNum(p.carts, 0)} | ${fmtNum(p.views, 0)} | ¥${fmtNum(p.orderCost, 1)} | ${cartRate} | ${p.decision || '-'} |`);
    }
    sections.push(lines.join('\n'));
  }

  // --- 淘宝直播 ---
  if (kpi && (kpi.totalTaobaoOrders || kpi.taobaoOrders)) {
    sections.push([
      '## 淘宝直播参考',
      `- 成交笔数：${fmtNum(kpi.totalTaobaoOrders ?? kpi.taobaoOrders, 0)} / 成交金额：¥${fmtMoney(kpi.taobaoSales ?? kpi.totalTaobaoSales)} / 退款金额：¥${fmtMoney(kpi.totalReturnAmount)}`,
    ].join('\n'));
  }

  return sections.length > 0 ? sections.join('\n\n') : '暂无可用数据';
}

export function buildReportFromDashboardPayload(
  payload: DashboardPayloadLike,
  startDate: string,
  endDate: string,
  analysisType: string,
  reportSchemaVersion: string
): DailyReportResult {
  const ads = payload.ads || {};
  const kpi = ads.kpi || {};
  const crowdRows = payload.crowd?.summary || [];

  const promptData: AnalysisData = {
    dateRange: `${startDate} ~ ${endDate}`,
    fullDataContext: buildFullDataContext(payload),
  };

  const structuredData: StructuredReportPayload = {
    meta: {
      reportType: analysisType,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      version: reportSchemaVersion,
    },
    executiveSummary: {
      headline: '基于看板聚合数据的 AI 分析',
      overallJudgement: 'cautious',
      riskLevel: 'medium',
    },
    overviewMetrics: {
      totalCost: fmtNum(kpi.totalCost, 2),
      totalAmount: fmtNum(kpi.totalAmount, 2),
      totalOrders: fmtNum(kpi.totalOrders, 0),
      roi: fmtNum(kpi.avgRoi, 3),
      returnRoi: fmtNum(kpi.totalReturnRoi, 3),
      finMargin: String(kpi.finMargin ?? '数据不足'),
      returnRate: typeof kpi.totalReturnRate === 'number' ? `${kpi.totalReturnRate.toFixed(2)}%` : '数据不足',
    },
    highSpendCrowds: [],
    keySegments: [],
    financeAdjustment: {
      summary: '参考看板成本拆分',
      costStructure: [],
      finMargin: String(kpi.finMargin ?? '数据不足'),
      returnRate: typeof kpi.totalReturnRate === 'number' ? `${kpi.totalReturnRate.toFixed(2)}%` : '数据不足',
    },
    liveSessionInsight: {
      summary: (ads?.daily && ads.daily.length > 0) ? `共 ${ads.daily.length} 天数据` : '暂无直播场次数据',
      sessions: [],
    },
    issues: [],
    actions: [],
    tomorrowFocus: [],
    tags: [],
  };

  const inputSnapshot = {
    reportTitle: buildReportTitle(analysisType, startDate, endDate),
    dateRange: promptData.dateRange,
    sourceMetrics: structuredData.overviewMetrics,
    highSpendCrowds: [],
    keySegments: [],
    costStructure: [],
    liveSessions: [],
  };

  return {
    promptData,
    structuredData,
    inputSnapshot,
    reportTitle: buildReportTitle(analysisType, startDate, endDate),
    reportSummary: '基于看板聚合数据的快速分析',
    riskLevel: 'medium',
    tags: [],
  };
}
