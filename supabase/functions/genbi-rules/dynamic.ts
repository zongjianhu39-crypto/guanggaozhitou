import { getDashboardPayload } from '../_shared/dashboard-payload.ts';
import type { GenbiRange } from '../_shared/genbi-time.ts';
import { buildAnswerEnvelope, composeTable, money, percent, ratio, computeChangeRate } from '../_shared/genbi-format.ts';
import { mapPayloadCrowdSummary, mapPayloadSingleItems } from '../_shared/genbi-payload-adapters.ts';
import { resolveRuleByIntent } from '../_shared/genbi-rule-resolver.ts';

type DynamicRuleContext = {
  question: string;
  range: GenbiRange;
};

type MetricFormatter = {
  label: string;
  format: (value: number) => string;
  extract: (data: Record<string, unknown>) => number;
};

const METRIC_FORMATTERS: Record<string, MetricFormatter> = {
  ad_cost: {
    label: '花费',
    format: money,
    extract: (data) => Number(data['花费'] ?? data['ad_cost'] ?? data['cost'] ?? 0),
  },
  order_cost: {
    label: '订单成本',
    format: money,
    extract: (data) => Number(data['订单成本'] ?? data['order_cost'] ?? data['orderCost'] ?? 0),
  },
  direct_roi: {
    label: '直接ROI',
    format: ratio,
    extract: (data) => Number(data['直接ROI'] ?? data['direct_roi'] ?? data['directRoi'] ?? 0),
  },
  product_direct_roi: {
    label: '商品直接ROI',
    format: ratio,
    extract: (data) => Number(data['商品直接ROI'] ?? data['product_direct_roi'] ?? data['productDirectRoi'] ?? 0),
  },
  gmv: {
    label: '总成交金额',
    format: money,
    extract: (data) => Number(data['总成交金额'] ?? data['gmv'] ?? data['amount'] ?? 0),
  },
  product_direct_gmv: {
    label: '商品直接成交金额',
    format: money,
    extract: (data) => Number(data['商品直接成交金额'] ?? data['product_direct_gmv'] ?? data['productAmount'] ?? 0),
  },
  product_orders: {
    label: '商品直接成交笔数',
    format: (v) => String(Math.round(v)),
    extract: (data) => Number(data['商品直接成交笔数'] ?? data['product_orders'] ?? data['productOrders'] ?? 0),
  },
  orders: {
    label: '成交笔数',
    format: (v) => String(Math.round(v)),
    extract: (data) => Number(data['成交笔数'] ?? data['orders'] ?? 0),
  },
  crowd_cost_share: {
    label: '人群花费占比',
    format: percent,
    extract: (data) => Number(data['人群花费占比'] ?? data['crowd_cost_share'] ?? data['costShare'] ?? 0),
  },
  wow: {
    label: '周环比',
    format: percent,
    extract: (data) => Number(data['周环比'] ?? data['wow'] ?? 0),
  },
  mom: {
    label: '月环比',
    format: percent,
    extract: (data) => Number(data['月环比'] ?? data['mom'] ?? 0),
  },
  breakeven_roi: {
    label: '盈亏平衡ROI',
    format: ratio,
    extract: (data) => Number(data['盈亏平衡ROI'] ?? data['breakeven_roi'] ?? data['breakevenRoi'] ?? 0),
  },
};

function getMetricFormatter(metricKey: string): MetricFormatter | null {
  return METRIC_FORMATTERS[metricKey] || null;
}

function buildDynamicAnswer(
  intent: string,
  ruleKey: string,
  rule: Record<string, unknown>,
  range: GenbiRange,
  dataScope: 'crowd' | 'single' | 'ads',
  data: any[],
): Record<string, unknown> {
  const config = rule.strategy && typeof rule.strategy === 'object' ? rule.strategy as Record<string, unknown> : {};
  const output = rule.output && typeof rule.output === 'object' ? rule.output as Record<string, unknown> : {};
  const filters = rule.filters && typeof rule.filters === 'object' ? rule.filters as Record<string, unknown> : {};
  
  const primaryMetric = String(config.primaryMetric || '');
  const secondaryMetric = String(config.secondaryMetric || '');
  const topCount = Number(output.topCount || output.tableLimit || 10);
  const highlightCount = Number(output.highlightCount || Math.min(3, topCount));

  // ============ 高级过滤逻辑 ============
  
  let filteredData = [...data];
  
  // 过滤 1：最小花费占比过滤（用于 crowdBudget）
  const minCostShare = Number(filters.minCostShare);
  if (Number.isFinite(minCostShare) && minCostShare > 0) {
    filteredData = filteredData.filter((item) => {
      const costShare = Number(item.costShare || 0);
      return costShare >= minCostShare;
    });
  }
  
  // 过滤 2：排除特定分层（用于 crowdBudget）
  const excludeLayers = Array.isArray(filters.excludeLayers) ? filters.excludeLayers.map(String) : [];
  if (excludeLayers.length > 0) {
    const excludeSet = new Set(excludeLayers);
    filteredData = filteredData.filter((item) => {
      const layer = String(item.layer || item.crowd || '');
      return !excludeSet.has(layer);
    });
  }
  
  // 过滤 3：要求主要指标有效（用于 crowdBudget）
  if (filters.requireFinitePrimaryMetric && primaryMetric) {
    const formatter = getMetricFormatter(primaryMetric);
    if (formatter) {
      filteredData = filteredData.filter((item) => {
        const value = formatter.extract(item);
        return Number.isFinite(value) && value > 0;
      });
    }
  }
  
  // 过滤 4：FocusPool 筛选逻辑（用于 weakProducts）
  const minFocusPoolSize = Number(filters.minFocusPoolSize);
  const focusPoolCostCoverage = Number(filters.focusPoolCostCoverage);
  if (Number.isFinite(minFocusPoolSize) && dataScope === 'single') {
    const totalCost = filteredData.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const sortedByCost = [...filteredData].sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0));
    
    let cumulativeCost = 0;
    const focusPoolSet = new Set(
      sortedByCost.filter((item, index) => {
        cumulativeCost += Number(item.cost || 0);
        if (index < minFocusPoolSize) return true;
        if (totalCost <= 0) return false;
        return cumulativeCost / totalCost <= focusPoolCostCoverage;
      }).map((item) => item.productName || item.productId)
    );
    
    filteredData = filteredData.filter((item) => 
      focusPoolSet.has(item.productName || item.productId)
    );
  }
  
  // 过滤 5：要求正花费（用于 weakProducts, productPotential）
  if (filters.requirePositiveCost) {
    filteredData = filteredData.filter((item) => Number(item.cost || 0) > 0);
  }
  
  // 过滤 6：要求正订单数（用于 productPotential）
  if (filters.requirePositiveOrders) {
    filteredData = filteredData.filter((item) => Number(item.productOrders || item.orders || 0) > 0);
  }

  // ============ 高级排序逻辑 ============
  
  let sortedData = [...filteredData];
  const sortArray = Array.isArray(config.sort) ? config.sort : [];
  
  // 支持多字段排序（用于 weakProducts）
  if (sortArray.length > 0) {
    sortedData.sort((a, b) => {
      for (const sortKey of sortArray) {
        const sortStr = String(sortKey);
        
        // primary_asc: 主要指标升序
        if (sortStr === 'primary_asc' && primaryMetric) {
          const formatter = getMetricFormatter(primaryMetric);
          if (formatter) {
            const diff = formatter.extract(a) - formatter.extract(b);
            if (diff !== 0) return diff;
          }
        }
        
        // primary_desc: 主要指标降序
        if (sortStr === 'primary_desc' && primaryMetric) {
          const formatter = getMetricFormatter(primaryMetric);
          if (formatter) {
            const diff = formatter.extract(b) - formatter.extract(a);
            if (diff !== 0) return diff;
          }
        }
        
        // secondary_desc: 次要指标降序
        if (sortStr === 'secondary_desc' && secondaryMetric) {
          const formatter = getMetricFormatter(secondaryMetric);
          if (formatter) {
            const diff = formatter.extract(b) - formatter.extract(a);
            if (diff !== 0) return diff;
          }
        }
        
        // cost_desc: 花费降序
        if (sortStr === 'cost_desc') {
          const diff = Number(b.cost || 0) - Number(a.cost || 0);
          if (diff !== 0) return diff;
        }
        
        // roi_x_gmv_desc: ROI * GMV 降序（用于 productPotential）
        if (sortStr === 'roi_x_gmv_desc') {
          const roiA = Number(a.productDirectRoi || a.directRoi || 0);
          const gmvA = Number(a.productAmount || a.directAmount || 0);
          const roiB = Number(b.productDirectRoi || b.directRoi || 0);
          const gmvB = Number(b.productAmount || b.directAmount || 0);
          const diff = (roiB * gmvB) - (roiA * gmvA);
          if (diff !== 0) return diff;
        }
      }
      return 0;
    });
  } else {
    // 简单排序模式
    const sortMode = String(config.increaseSort || config.decreaseSort || '');
    
    if (sortMode.includes('asc') && primaryMetric) {
      const formatter = getMetricFormatter(primaryMetric);
      if (formatter) {
        sortedData.sort((a, b) => formatter.extract(a) - formatter.extract(b));
      }
    } else if (sortMode.includes('desc') && primaryMetric) {
      const formatter = getMetricFormatter(primaryMetric);
      if (formatter) {
        sortedData.sort((a, b) => formatter.extract(b) - formatter.extract(a));
      }
    } else if (primaryMetric) {
      // 默认降序
      const formatter = getMetricFormatter(primaryMetric);
      if (formatter) {
        sortedData.sort((a, b) => formatter.extract(b) - formatter.extract(a));
      }
    }
  }

  const topItems = sortedData.slice(0, topCount);
  const highlights = topItems.slice(0, highlightCount);

  // 构建表格列
  const columns = ['指标'];
  const metricKeys = Array.isArray(config.metrics) 
    ? config.metrics.map(String) 
    : primaryMetric ? [primaryMetric, secondaryMetric].filter(Boolean) 
    : [];

  metricKeys.forEach((key) => {
    const formatter = getMetricFormatter(key);
    if (formatter) columns.push(formatter.label);
  });

  // 根据数据范围添加标识列
  if (dataScope === 'crowd') {
    columns.unshift('人群分层');
  } else if (dataScope === 'single') {
    columns.unshift('商品');
  }

  // 构建表格行
  const rows = topItems.map((item) => {
    const row: Record<string, unknown> = {};
    if (dataScope === 'crowd') {
      row['人群分层'] = item.layer || item.crowd || '未知';
    } else if (dataScope === 'single') {
      row['商品'] = item.productName || item.product || '未知商品';
    }
    
    metricKeys.forEach((key) => {
      const formatter = getMetricFormatter(key);
      if (formatter) {
        row[formatter.label] = formatter.format(formatter.extract(item));
      }
    });
    
    return row;
  });

  // 构建回答文本
  const title = String(rule.label || ruleKey);
  const answerParts = [
    `分析范围是 ${range.start} 至 ${range.end}。`,
  ];

  if (highlights.length > 0) {
    const highlightText = highlights.map((item) => {
      const name = dataScope === 'crowd' 
        ? (item.layer || item.crowd || '未知')
        : (item.productName || item.product || '未知商品');
      
      const metrics = metricKeys.map((key) => {
        const formatter = getMetricFormatter(key);
        return formatter ? `${formatter.label} ${formatter.format(formatter.extract(item))}` : '';
      }).filter(Boolean).join('，');
      
      return `${name}（${metrics}）`;
    }).join('、');
    
    answerParts.push(`重点关注：${highlightText}`);
  }

  const answer = answerParts.join('');

  return buildAnswerEnvelope(
    intent,
    title,
    answer,
    range,
    [composeTable(title, columns, rows)],
    highlights.map((item) => {
      const name = dataScope === 'crowd' 
        ? (item.layer || item.crowd || '未知')
        : (item.productName || item.product || '未知商品');
      return `重点关注：${name}`;
    }),
    [`当前基于动态规则引擎生成，规则 key: ${ruleKey}`],
  );
}

export async function answerDynamicRule(intent: string, context: DynamicRuleContext) {
  const resolved = await resolveRuleByIntent(intent as any);
  const rule = resolved.rule;
  
  if (!rule || Object.keys(rule).length === 0) {
    return buildAnswerEnvelope(
      intent,
      '规则配置缺失',
      `意图 ${intent} 对应的规则配置不完整，无法执行数据查询。`,
      context.range,
      [],
      [],
      ['规则配置为空或不存在'],
    );
  }

  // 解析数据范围
  const dataScope = Array.isArray(rule.dataScope) ? rule.dataScope : [];
  const hasCrowd = dataScope.includes('crowd');
  const hasSingle = dataScope.includes('single');
  const hasAds = dataScope.includes('ads');

  try {
    const payload = await getDashboardPayload(
      context.range.start,
      context.range.end,
      { ads: hasAds, crowd: hasCrowd, single: hasSingle },
    ) as any;

    // 根据数据范围选择数据源
    if (hasCrowd && payload?.crowd?.summary) {
      const crowdData = mapPayloadCrowdSummary(payload.crowd.summary);
      return buildDynamicAnswer(intent, resolved.ruleKey || intent, rule, context.range, 'crowd', crowdData as any);
    }
    
    if (hasSingle && payload?.single?.items) {
      const singleData = mapPayloadSingleItems(payload.single.items);
      return buildDynamicAnswer(intent, resolved.ruleKey || intent, rule, context.range, 'single', singleData as any);
    }
    
    if (hasAds && payload?.ads?.kpi) {
      const adsData = [{
        cost: Number(payload.ads.kpi.totalCost || 0),
        breakevenRoi: Number(payload.ads.kpi.totalBreakevenRoi || 0),
        amount: Number(payload.ads.kpi.totalAmount || 0),
        orders: Number(payload.ads.kpi.totalOrders || 0),
      }];
      return buildDynamicAnswer(intent, resolved.ruleKey || intent, rule, context.range, 'ads', adsData as any);
    }

    return buildAnswerEnvelope(
      intent,
      '暂无数据',
      `在 ${context.range.start} 至 ${context.range.end} 期间没有找到相关数据。`,
      context.range,
      [],
      [],
      ['数据源为空'],
    );
  } catch (error) {
    console.error(`[dynamic-rule] error executing rule ${resolved.ruleKey}:`, error);
    return buildAnswerEnvelope(
      intent,
      '数据查询失败',
      `执行规则 ${resolved.ruleKey || intent} 时发生错误：${error instanceof Error ? error.message : '未知错误'}`,
      context.range,
      [],
      [],
      ['动态规则执行异常'],
    );
  }
}
