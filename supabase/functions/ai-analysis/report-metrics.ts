import type {
  BudgetDecision,
  CostStructureItem,
  CrowdInsight,
  DataRow,
  LiveSessionItem,
  MetricBucket,
  OverallJudgement,
  ProductInsight,
  ReportAction,
  ReportIssue,
  RiskLevel,
  SegmentInsight,
} from './analysis-types.ts';

export const toNum = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return parseFloat(value.replace(/,/g, '').trim()) || 0;
  return 0;
};

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function toPercent(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

export function buildReportTitle(analysisType: string, startDate: string, endDate: string): string {
  const label = analysisType === 'daily'
    ? '直播投放日报'
    : analysisType === 'single'
      ? '单品广告分析'
      : '直播投放分析';
  return startDate === endDate ? `${startDate} ${label}` : `${startDate} 至 ${endDate} ${label}`;
}

export function buildReportSlug(analysisType: string, startDate: string, endDate: string): string {
  return `${analysisType}-${startDate}-${endDate}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

export function buildFallbackHeadline(
  riskLevel: RiskLevel,
  worstCrowd: CrowdInsight | undefined,
  bestCrowd: CrowdInsight | undefined,
  returnRate: number,
  finMargin: number
): string {
  if (riskLevel === 'critical' || riskLevel === 'high') {
    if (worstCrowd) {
      return `整体投放承压，${worstCrowd.name} 作为高消耗人群正在拖累整体效率，建议优先收缩。`;
    }
    return '整体投放承压，建议优先排查高消耗人群和退款对真实回报的侵蚀。';
  }

  if (bestCrowd && bestCrowd.decision === 'increase' && finMargin >= 10 && returnRate < 8) {
    return `整体表现相对稳健，${bestCrowd.name} 在高消耗人群中效率更优，可作为重点放量方向。`;
  }

  return '整体表现中性，建议继续围绕高消耗人群做结构优化并观察利润修正后的真实回报。';
}

export function decideBudgetAction(roi: number, overallRoi: number, costShare: number): { decision: BudgetDecision; reason: string } {
  if (roi < 1) {
    return { decision: 'reduce', reason: 'ROI 低于 1，投入回报不足' };
  }

  if (costShare >= 20 && roi <= Math.max(1, overallRoi * 0.85)) {
    return { decision: 'reduce', reason: '高消耗但 ROI 明显低于整体' };
  }

  if (costShare >= 12 && roi >= overallRoi * 1.1) {
    return { decision: 'increase', reason: '高消耗且 ROI 优于整体，可继续承接预算' };
  }

  return { decision: 'observe', reason: '当前样本有效，但仍需继续观察波动' };
}

export function rankHighSpendCrowds(
  crowdMap: Map<string, MetricBucket>,
  totalCost: number,
  overallRoi: number
): CrowdInsight[] {
  return [...crowdMap.entries()]
    .map(([name, bucket]) => {
      const roi = bucket.cost > 0 ? bucket.amount / bucket.cost : 0;
      const orderCost = bucket.orders > 0 ? bucket.cost / bucket.orders : 0;
      const costShare = totalCost > 0 ? (bucket.cost / totalCost) * 100 : 0;
      const { decision, reason } = decideBudgetAction(roi, overallRoi, costShare);
      return {
        name,
        cost: bucket.cost,
        costShare,
        roi,
        orderCost,
        orders: bucket.orders,
        decision,
        reason,
      };
    })
    .filter((item) => item.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);
}

export function rankKeySegments(
  crowdNameMap: Map<string, { category: string; bucket: MetricBucket }>,
  totalCost: number,
  overallRoi: number
): SegmentInsight[] {
  const ranked = [...crowdNameMap.entries()]
    .map(([name, value]) => {
      const roi = value.bucket.cost > 0 ? value.bucket.amount / value.bucket.cost : 0;
      const orderCost = value.bucket.orders > 0 ? value.bucket.cost / value.bucket.orders : 0;
      const costShare = totalCost > 0 ? (value.bucket.cost / totalCost) * 100 : 0;
      const { decision, reason } = decideBudgetAction(roi, overallRoi, costShare);
      return {
        name,
        category: value.category,
        cost: value.bucket.cost,
        costShare,
        roi,
        orderCost,
        decision,
        reason,
      };
    })
    .filter((item) => item.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  if (ranked.length === 0) return [];

  const pool = ranked.slice(0, Math.min(8, ranked.length));
  const selected: SegmentInsight[] = [];

  const pushUnique = (item?: SegmentInsight) => {
    if (!item) return;
    if (selected.some((row) => row.name === item.name)) return;
    selected.push(item);
  };

  pushUnique(pool[0]);
  pushUnique([...pool].sort((a, b) => b.roi - a.roi || b.cost - a.cost)[0]);
  pushUnique([...pool].sort((a, b) => a.roi - b.roi || b.cost - a.cost)[0]);

  return selected.slice(0, 3);
}

export function rankCostStructure(costItems: Array<[string, number]>, totalFinCost: number): CostStructureItem[] {
  return costItems
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, amount]) => ({
      name,
      amount,
      share: totalFinCost > 0 ? (amount / totalFinCost) * 100 : 0,
    }));
}

export function rankLiveSessions(taobaoData: DataRow[]): LiveSessionItem[] {
  const sessionMap = new Map<string, LiveSessionItem>();

  for (const row of taobaoData) {
    const sessionName = String(row['场次信息'] ?? '').trim() || String(row['日期'] ?? '未命名场次');
    const current = sessionMap.get(sessionName) ?? {
      name: sessionName,
      amount: 0,
      views: 0,
      orders: 0,
      buyerRate: 0,
      refundRate: 0,
    };
    const nextViews = current.views + toNum(row['观看人数']);
    const nextAmount = current.amount + toNum(row['成交金额']);
    const nextOrders = current.orders + toNum(row['成交笔数']);
    const buyers = toNum(row['成交人数']);
    const refunds = toNum(row['退款金额']);

    sessionMap.set(sessionName, {
      name: sessionName,
      amount: nextAmount,
      views: nextViews,
      orders: nextOrders,
      buyerRate: nextViews > 0 ? ((buyers + current.buyerRate * current.views / 100) / nextViews) * 100 : 0,
      refundRate: nextAmount > 0 ? ((refunds + current.refundRate * current.amount / 100) / nextAmount) * 100 : 0,
    });
  }

  return [...sessionMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 2);
}

export function summarizeHighSpendCrowds(items: CrowdInsight[]): string {
  if (items.length === 0) return '暂无人群分类数据';

  return items
    .map(
      (item, index) =>
        `${index + 1}.${item.name} 花费¥${item.cost.toFixed(0)}（占比${item.costShare.toFixed(1)}%），ROI ${item.roi.toFixed(2)}，成交${Math.round(item.orders)}单，订单成本¥${item.orderCost.toFixed(1)}`
    )
    .join('；');
}

export function summarizeKeySegments(items: SegmentInsight[]): string {
  if (items.length === 0) return '暂无具体人群数据';

  const labels = ['高消耗重点', '高消耗优质', '高消耗预警'];
  return items
    .map(
      (item, index) =>
        `${labels[index] ?? '重点人群'}：${item.name}（${item.category}），花费¥${item.cost.toFixed(0)}，ROI ${item.roi.toFixed(2)}，订单成本¥${item.orderCost.toFixed(1)}`
    )
    .join('；');
}

export function summarizeCostStructure(items: CostStructureItem[]): string {
  if (items.length === 0) return '暂无成本拆分数据';
  return items
    .map((item) => `${item.name}¥${item.amount.toFixed(0)}（占成本${item.share.toFixed(1)}%）`)
    .join('；');
}

export function summarizeLiveSessions(items: LiveSessionItem[]): string {
  if (items.length === 0) return '暂无直播场次数据';
  return `共${items.length}个重点场次；${items
    .map(
      (item) =>
        `${item.name} 成交¥${item.amount.toFixed(0)}，观看${Math.round(item.views)}，成交笔数${Math.round(item.orders)}，退款率${item.refundRate.toFixed(2)}%`
    )
    .join('；')}`;
}

export function rankSingleProducts(rows: DataRow[], totalCost: number, overallRoi: number): ProductInsight[] {
  const productMap = new Map<string, {
    productId: string;
    name: string;
    cost: number;
    amount: number;
    orders: number;
    carts: number;
    views: number;
  }>();

  for (const row of rows) {
    const productId = String(row['商品id'] ?? '').trim() || String(row['商品名称'] ?? 'unknown');
    const name = String(row['商品名称'] ?? '').trim() || '未命名商品';
    const current = productMap.get(productId) ?? {
      productId,
      name,
      cost: 0,
      amount: 0,
      orders: 0,
      carts: 0,
      views: 0,
    };

    current.cost += toNum(row['花费']);
    current.amount += toNum(row['该商品直接成交金额'] ?? row['直接成交金额']);
    current.orders += toNum(row['该商品直接成交笔数'] ?? row['直接成交笔数']);
    current.carts += toNum(row['该商品加购数']);
    current.views += toNum(row['观看人数']);
    productMap.set(productId, current);
  }

  return [...productMap.values()]
    .map((item) => {
      const roi = item.cost > 0 ? item.amount / item.cost : 0;
      const orderCost = item.orders > 0 ? item.cost / item.orders : 0;
      const costShare = totalCost > 0 ? (item.cost / totalCost) * 100 : 0;
      const { decision, reason } = decideBudgetAction(roi, overallRoi, costShare);
      return {
        ...item,
        roi,
        orderCost,
        costShare,
        decision,
        reason,
      };
    })
    .filter((item) => item.cost > 0)
    .sort((left, right) => right.cost - left.cost);
}

export function summarizeSingleProducts(items: ProductInsight[]): string {
  if (!items.length) return '暂无单品广告数据';
  return items
    .slice(0, 3)
    .map((item, index) =>
      `${index + 1}.${item.name} 花费¥${item.cost.toFixed(0)}（占比${item.costShare.toFixed(1)}%），商品ROI ${item.roi.toFixed(2)}，商品成交${Math.round(item.orders)}单，加购${Math.round(item.carts)}次`
    )
    .join('；');
}

export function summarizeBestSingleProducts(items: ProductInsight[]): string {
  const candidates = items
    .filter((item) => item.cost >= 1000 || item.orders > 0)
    .sort((left, right) => right.roi - left.roi || right.amount - left.amount)
    .slice(0, 3);
  if (!candidates.length) return '暂无高效率商品';
  return candidates
    .map((item, index) =>
      `${index + 1}.${item.name} 商品ROI ${item.roi.toFixed(2)}，商品成交¥${item.amount.toFixed(0)}，订单成本¥${item.orderCost.toFixed(1)}`
    )
    .join('；');
}

export function summarizeWeakSingleProducts(items: ProductInsight[], overallRoi: number): string {
  const candidates = items
    .filter((item) => item.cost > 0 && (item.orders === 0 || item.roi < Math.max(1, overallRoi * 0.7)))
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 3);
  if (!candidates.length) return '暂无明显低效率商品';
  return candidates
    .map((item, index) =>
      `${index + 1}.${item.name} 花费¥${item.cost.toFixed(0)}，商品ROI ${item.roi.toFixed(2)}，商品成交${Math.round(item.orders)}单`
    )
    .join('；');
}

export function summarizeCartOpportunities(items: ProductInsight[]): string {
  const candidates = items
    .filter((item) => item.carts > 0 || item.views > 0)
    .sort((left, right) => (right.carts - left.carts) || (right.views - left.views))
    .slice(0, 3);
  if (!candidates.length) return '暂无明显加购机会';
  return candidates
    .map((item, index) => {
      const cartRate = item.views > 0 ? (item.carts / item.views) * 100 : 0;
      return `${index + 1}.${item.name} 观看${Math.round(item.views)}，加购${Math.round(item.carts)}，加购率${cartRate.toFixed(2)}%`;
    })
    .join('；');
}

export function buildSingleRiskLevel(roi: number, zeroOrderCostShare: number): RiskLevel {
  if (roi < 1 || zeroOrderCostShare >= 45) return 'critical';
  if (roi < 1.5 || zeroOrderCostShare >= 30) return 'high';
  if (roi < 2 || zeroOrderCostShare >= 15) return 'medium';
  return 'low';
}

export function buildSingleFallbackHeadline(riskLevel: RiskLevel, topProduct?: ProductInsight, bestProduct?: ProductInsight): string {
  if ((riskLevel === 'critical' || riskLevel === 'high') && topProduct) {
    return `单品投放承压，${topProduct.name} 作为高消耗商品需要优先复盘是否继续承接预算。`;
  }
  if (bestProduct && bestProduct.roi >= 2) {
    return `单品投放结构可优化，${bestProduct.name} 当前效率更优，可作为优先放量对象。`;
  }
  return '单品投放整体表现中性，建议继续围绕高消耗商品做结构优化。';
}

export function buildRiskLevel(params: {
  roi: number;
  returnRoi: number;
  finMargin: number;
  returnRate: number;
  yoyRoiDelta: number | null;
}): RiskLevel {
  const { roi, returnRoi, finMargin, returnRate, yoyRoiDelta } = params;
  if (returnRoi < 1 || finMargin < 0) return 'critical';
  if (returnRoi < 1.5 || finMargin < 5 || returnRate >= 15 || (yoyRoiDelta !== null && yoyRoiDelta <= -20)) return 'high';
  if (roi < 2 || finMargin < 10 || returnRate >= 8 || (yoyRoiDelta !== null && yoyRoiDelta <= -10)) return 'medium';
  return 'low';
}

export function pickOverallJudgement(riskLevel: RiskLevel): OverallJudgement {
  if (riskLevel === 'low') return 'positive';
  if (riskLevel === 'medium') return 'cautious';
  return 'negative';
}

export function buildIssues(args: {
  worstCrowd?: CrowdInsight;
  bestCrowd?: CrowdInsight;
  returnRate: number;
  finMargin: number;
  liveSessions: LiveSessionItem[];
  viewConvertRate: number;
}): ReportIssue[] {
  const { worstCrowd, bestCrowd, returnRate, finMargin, liveSessions, viewConvertRate } = args;
  const issues: ReportIssue[] = [];

  if (worstCrowd && worstCrowd.decision === 'reduce') {
    issues.push({
      title: `${worstCrowd.name} 高消耗低效率`,
      severity: 'high',
      evidence: `花费占比 ${worstCrowd.costShare.toFixed(1)}%，ROI ${worstCrowd.roi.toFixed(2)}`,
      impact: '会直接拖累整体投放效率和预算利用率',
    });
  }

  if (returnRate >= 8) {
    issues.push({
      title: '退款侵蚀真实回报',
      severity: returnRate >= 15 ? 'critical' : 'high',
      evidence: `退货率 ${returnRate.toFixed(2)}%`,
      impact: '表面 ROI 与真实经营 ROI 可能出现明显偏差',
    });
  }

  if (finMargin < 10) {
    issues.push({
      title: '毛利率承压',
      severity: finMargin < 0 ? 'critical' : 'medium',
      evidence: `毛利率 ${finMargin.toFixed(2)}%`,
      impact: '即使成交看起来不错，利润空间也可能不足',
    });
  }

  const topSession = liveSessions[0];
  if (topSession && topSession.refundRate >= 8) {
    issues.push({
      title: '头部场次退款率偏高',
      severity: 'medium',
      evidence: `${topSession.name} 退款率 ${topSession.refundRate.toFixed(2)}%`,
      impact: '会削弱高流量场次的真实成交价值',
    });
  }

  if (viewConvertRate < 2) {
    issues.push({
      title: '观看转化偏弱',
      severity: 'medium',
      evidence: `观看转化率 ${viewConvertRate.toFixed(2)}%`,
      impact: '流量已进场，但承接效率不足',
    });
  }

  if (issues.length === 0 && bestCrowd) {
    issues.push({
      title: `${bestCrowd.name} 可作为正向样本`,
      severity: 'low',
      evidence: `ROI ${bestCrowd.roi.toFixed(2)}，花费占比 ${bestCrowd.costShare.toFixed(1)}%`,
      impact: '可作为后续放量和优化参考对象',
    });
  }

  return issues.slice(0, 4);
}

export function buildActions(args: {
  worstCrowd?: CrowdInsight;
  bestCrowd?: CrowdInsight;
  worstSegment?: SegmentInsight;
  bestSegment?: SegmentInsight;
  returnRate: number;
  finMargin: number;
  topCostItem?: CostStructureItem;
  topSession?: LiveSessionItem;
}): ReportAction[] {
  const { worstCrowd, bestCrowd, worstSegment, bestSegment, returnRate, finMargin, topCostItem, topSession } = args;
  const actions: ReportAction[] = [];

  if (worstCrowd && worstCrowd.decision === 'reduce') {
    actions.push({
      title: `下调 ${worstCrowd.name} 预算`,
      target: worstCrowd.name,
      reason: worstCrowd.reason,
      priority: 'p0',
    });
  }

  if (bestCrowd && bestCrowd.decision === 'increase') {
    actions.push({
      title: `保留并放量 ${bestCrowd.name}`,
      target: bestCrowd.name,
      reason: bestCrowd.reason,
      priority: 'p1',
    });
  }

  if (worstSegment && worstSegment.decision === 'reduce') {
    actions.push({
      title: `收缩具体人群 ${worstSegment.name}`,
      target: worstSegment.name,
      reason: `${worstSegment.category} 内部低效高消耗`,
      priority: 'p0',
    });
  }

  if (bestSegment && bestSegment.decision === 'increase') {
    actions.push({
      title: `复制 ${bestSegment.name} 的预算分配逻辑`,
      target: bestSegment.name,
      reason: '该人群在高消耗样本中效率更优',
      priority: 'p1',
    });
  }

  if (returnRate >= 8) {
    actions.push({
      title: '复盘退款高的订单来源',
      target: '退款订单',
      reason: '避免表面 ROI 掩盖真实经营问题',
      priority: 'p0',
    });
  }

  if (finMargin < 10 && topCostItem) {
    actions.push({
      title: `排查 ${topCostItem.name} 成本占比`,
      target: topCostItem.name,
      reason: '毛利率承压，需要优先看大头成本',
      priority: 'p1',
    });
  }

  if (topSession && topSession.refundRate >= 8) {
    actions.push({
      title: `重点复盘场次 ${topSession.name}`,
      target: topSession.name,
      reason: '头部场次退款偏高，需要排查承接与商品匹配',
      priority: 'p2',
    });
  }

  return actions.slice(0, 5);
}

export function buildTomorrowFocus(args: {
  worstCrowd?: CrowdInsight;
  returnRate: number;
  finMargin: number;
  topSession?: LiveSessionItem;
}): string[] {
  const items = ['整体 ROI', '去退 ROI'];
  if (args.worstCrowd) items.push(`${args.worstCrowd.name} ROI`);
  if (args.returnRate >= 5) items.push('退款率');
  if (args.finMargin < 10) items.push('毛利率');
  if (args.topSession) items.push(`${args.topSession.name} 退款率`);
  return uniqueStrings(items).slice(0, 5);
}

export function buildTags(args: {
  riskLevel: RiskLevel;
  highSpendCrowds: CrowdInsight[];
  returnRate: number;
  finMargin: number;
  topSession?: LiveSessionItem;
}): string[] {
  const tags = ['高消耗人群'];
  if (args.highSpendCrowds.some((item) => item.decision === 'reduce')) tags.push('预算调整');
  if (args.highSpendCrowds.some((item) => item.decision === 'increase')) tags.push('放量对象');
  if (args.returnRate >= 5) tags.push('退款修正');
  if (args.finMargin < 10) tags.push('利润承压');
  if (args.topSession) tags.push('场次承接');
  if (args.riskLevel === 'critical' || args.riskLevel === 'high') tags.push('高风险');
  return uniqueStrings(tags);
}

export function classifyCrowd(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return '未知';

  const text = name.trim();

  if (text === '智能推荐人群' || text.startsWith('智能竞争直播间:')) return '纯黑盒';
  if (text.startsWith('自定义竞争宝贝:')) return '灰盒_竞争宝贝';
  if (text.startsWith('自定义竞争店铺:')) return '灰盒_竞争店铺';
  if (text.startsWith('自定义竞争直播间:')) return '灰盒_竞争直播间';

  if (['复购老客', '未通知到人群', '购买人群', '活跃成交', '活跃复购'].some((k) => text.includes(k))) {
    return '老客';
  }

  if (
    text.startsWith('粉丝人群:') ||
    text.startsWith('喜欢我的直播:') ||
    text.startsWith('喜欢我的短视频:') ||
    ['加购人群', '兴趣新客', '访问新客', '浏览'].some((k) => text.includes(k))
  ) {
    return '兴趣新客';
  }

  if (['首购新客', '差老客', '付定人群', '流失', '竞店人群'].some((k) => text.includes(k))) {
    return '新客';
  }

  if (text.startsWith('精选人群:') || text.startsWith('达摩盘人群:')) {
    if (['活跃复购', '活跃成交', '活跃下降', '即将流失', '差直播间老客', '差老客', '购买人群'].some((k) => text.includes(k))) {
      return '老客';
    }
    if (['加购人群', '兴趣新客', '访问新客', '浏览'].some((k) => text.includes(k))) {
      return '兴趣新客';
    }
    if (['首购新客', '未购', '流失', '竞店人群', '付定人群'].some((k) => text.includes(k))) {
      return '新客';
    }
    if (['宠物清洁', '直播低退', '达人带货品牌'].some((k) => text.includes(k))) {
      return '灰盒_竞争宝贝';
    }
    return '灰盒';
  }

  if (text.includes('活跃')) return '新客';
  return '未知';
}

export function createMetricBucket(): MetricBucket {
  return {
    cost: 0,
    amount: 0,
    orders: 0,
    views: 0,
    shows: 0,
    directAmount: 0,
    cart: 0,
    preOrders: 0,
    interactions: 0,
  };
}

export function accumulateMetrics(bucket: MetricBucket, row: DataRow): void {
  bucket.cost += toNum(row['花费']);
  bucket.amount += toNum(row['总成交金额']);
  bucket.orders += toNum(row['总成交笔数']);
  bucket.views += toNum(row['观看次数']);
  bucket.shows += toNum(row['展现量']);
  bucket.directAmount += toNum(row['直接成交金额']);
  bucket.cart += toNum(row['总购物车数']);
  bucket.preOrders += toNum(row['总预售成交笔数']);
  bucket.interactions += toNum(row['互动量']);
}

export function buildHighSpendCrowdSummary(crowdMap: Map<string, MetricBucket>, totalCost: number): string {
  return summarizeHighSpendCrowds(rankHighSpendCrowds(crowdMap, totalCost, 0));
}

export function buildCrowdNameSummary(
  crowdNameMap: Map<string, { category: string; bucket: MetricBucket }>
): string {
  return summarizeKeySegments(rankKeySegments(crowdNameMap, 0, 0));
}

export function buildCostStructureSummary(costItems: Array<[string, number]>, totalFinCost: number): string {
  return summarizeCostStructure(rankCostStructure(costItems, totalFinCost));
}

export function buildLiveSessionSummary(taobaoData: DataRow[]): string {
  return summarizeLiveSessions(rankLiveSessions(taobaoData));
}
