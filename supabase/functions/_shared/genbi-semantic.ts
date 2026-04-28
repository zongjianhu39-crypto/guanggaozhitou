import { listGenbiRuleConfigRecords, mergeGenbiRulesWithRecords } from './genbi-rule-store.ts';

type GenbiSemanticConfig = {
  version: string;
  docsSource: string;
  defaults?: Record<string, unknown>;
  rag?: Record<string, unknown>;
  ruleVersions?: Record<string, string>;
  intentRules?: Record<string, string>;
  rules?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  intentGroups?: Array<Record<string, unknown>>;
};

const DEFAULT_GENBI_SEMANTIC: GenbiSemanticConfig = {
  version: '2026-04-10',
  docsSource: 'docs/current/报表字段及关系-标准文档.md',
  rag: {
    enabled: true,
    maxReferences: 5,
    sources: {
      rulesDocs: {
        enabled: true,
        docs: ['docs/current/报表字段及关系-标准文档.md'],
      },
      promptTemplates: {
        enabled: true,
        limit: 6,
      },
      aiReports: {
        enabled: true,
        limit: 12,
      },
      aiPlaybooks: {
        enabled: false,
        limit: 0,
      },
    },
  },
  ruleVersions: {
    crowdBudget: 'v1',
    crowdMix: 'v1',
    dailyDropReason: 'v1',
    weakProducts: 'v1',
    productPotential: 'v1',
    productSales: 'v1',
    periodicReport: 'v1',
    lossReason: 'v1',
  },
  // 注意：intentRules 和 rules 已迁移到数据库，这里保留作为 fallback
  // 当数据库和外部 JSON 配置都不可用时，系统会使用这里的默认映射
  // 避免动态规则路径静默退化导致 unsupported fallback
  intentRules: {
    crowd_budget: 'crowdBudget',
    crowd_mix: 'crowdMix',
    daily_drop_reason: 'dailyDropReason',
    weak_products: 'weakProducts',
    product_potential: 'productPotential',
    product_sales: 'productSales',
    weekly_report: 'periodicReport',
    monthly_report: 'periodicReport',
    loss_reason: 'lossReason',
    budget_plan: 'crowdBudget',
  },
  rules: {
    // 以下为向后兼容的默认规则配置，实际使用中优先从数据库读取
    // crowdBudget: { ... },
    // crowdMix: { ... },
    // 已迁移到数据库，此处注释掉以避免混淆
  },
  metrics: {
    breakeven_roi: { label: '盈亏平衡ROI' },
    order_cost: { label: '订单成本' },
    direct_roi: { label: '直接ROI' },
    ad_cost: { label: '花费' },
    gmv: { label: '总成交金额' },
    product_direct_gmv: { label: '该商品直接成交金额' },
    product_direct_roi: { label: '商品直接ROI' },
    product_orders: { label: '商品直接成交笔数' },
    orders: { label: '成交笔数' },
    crowd_cost_share: { label: '人群花费占比' },
    wow: { label: '周环比' },
    mom: { label: '月环比' },
  },
  intentGroups: [
    { key: 'crowd_budget', label: '人群预算建议' },
    { key: 'weak_products', label: '高花费低回报商品诊断' },
    { key: 'crowd_mix', label: '老客新客结构分析' },
    { key: 'product_potential', label: '冲销售额商品识别' },
    { key: 'product_sales', label: '单商品销售查询' },
    { key: 'weekly_report', label: '周报生成' },
    { key: 'monthly_report', label: '月报生成' },
    { key: 'daily_drop_reason', label: '昨日花费波动归因' },
    { key: 'loss_reason', label: '亏损原因分析' },
  ],
};

let semanticCache: { value: GenbiSemanticConfig; expiresAt: number } | null = null;
// 缓存 5 分钟；save_rule 后会主动调用 clearGenbiSemanticConfigCache() 穿透，
// 其他 Edge 实例未实时触发时最多 5 分钟内自行失效。
const SEMANTIC_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadSemanticConfig(): Promise<GenbiSemanticConfig> {
  let fileConfig: GenbiSemanticConfig = DEFAULT_GENBI_SEMANTIC;
  try {
    const semanticUrl = new URL('../../../assets/data/genbi-semantic.json', import.meta.url);
    const raw = await Deno.readTextFile(semanticUrl);
    const parsed = JSON.parse(raw) as GenbiSemanticConfig;
    if (parsed && typeof parsed === 'object') {
      fileConfig = {
        ...DEFAULT_GENBI_SEMANTIC,
        ...parsed,
        rules: {
          ...(DEFAULT_GENBI_SEMANTIC.rules ?? {}),
          ...(parsed.rules ?? {}),
        },
      };
    }
  } catch {
    fileConfig = DEFAULT_GENBI_SEMANTIC;
  }

  try {
    const records = await listGenbiRuleConfigRecords();
    if (!records.length) return fileConfig;
    
    const mergedConfig = {
      ...fileConfig,
      rules: mergeGenbiRulesWithRecords(fileConfig.rules ?? {}, records),
    };

    // 动态构建 intentRules 映射：从数据库规则的 config.intentKey 读取
    const dynamicIntentRules = { ...(fileConfig.intentRules ?? {}) };
    records.forEach((record) => {
      const config = record.config || {};
      const intentKey = String(config.intentKey || '').trim();
      if (intentKey) {
        dynamicIntentRules[intentKey] = record.rule_key;
        console.log(`[genbi-semantic] dynamic intent mapping: ${intentKey} -> ${record.rule_key}`);
      }
    });
    mergedConfig.intentRules = dynamicIntentRules;

    return mergedConfig;
  } catch (error) {
    console.warn('[genbi-semantic] failed to load database rule configs:', error instanceof Error ? error.message : String(error));
    return fileConfig;
  }
}

export async function getGenbiSemanticConfig(): Promise<GenbiSemanticConfig> {
  const now = Date.now();
  if (!semanticCache || semanticCache.expiresAt <= now) {
    semanticCache = {
      value: await loadSemanticConfig(),
      expiresAt: now + SEMANTIC_CACHE_TTL_MS,
    };
  }
  return semanticCache.value;
}

export function clearGenbiSemanticConfigCache() {
  semanticCache = null;
}

export async function getGenbiRules() {
  const semantic = await getGenbiSemanticConfig();
  return semantic.rules ?? DEFAULT_GENBI_SEMANTIC.rules ?? {};
}

export type { GenbiSemanticConfig };
