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
  },
  rules: {
    crowdBudget: {
      label: '人群预算建议',
      version: 'v1',
      dataScope: ['crowd'],
      strategy: {
        primaryMetric: 'order_cost',
        secondaryMetric: 'crowd_cost_share',
        increaseSort: 'primary_asc',
        decreaseSort: 'primary_desc',
      },
      filters: {
        minCostShare: 0.05,
        excludeLayers: ['未知'],
        requireFinitePrimaryMetric: true,
      },
      output: {
        topIncreaseCount: 3,
        topDecreaseCount: 3,
        tableLimit: 10,
      },
    },
    crowdMix: {
      label: '老客新客结构分析',
      version: 'v1',
      dataScope: ['crowd'],
      strategy: {
        primaryMetric: 'crowd_cost_share',
        comparisonLayers: ['老客', '新客', '兴趣新客'],
      },
    },
    dailyDropReason: {
      label: '昨日花费波动归因',
      version: 'v1',
      dataScope: ['crowd'],
      strategy: {
        primaryMetric: 'ad_cost',
        comparisonMode: 'current_vs_previous',
      },
      output: {
        topDropCount: 3,
      },
    },
    weakProducts: {
      label: '高花费低回报商品',
      version: 'v1',
      dataScope: ['single'],
      strategy: {
        primaryMetric: 'product_direct_roi',
        secondaryMetric: 'order_cost',
        sort: ['primary_asc', 'secondary_desc', 'cost_desc'],
      },
      filters: {
        minFocusPoolSize: 20,
        focusPoolCostCoverage: 0.85,
        requirePositiveCost: true,
      },
      output: {
        topCount: 8,
        highlightCount: 3,
      },
    },
    productPotential: {
      label: '冲销售额商品识别',
      version: 'v1',
      dataScope: ['single'],
      strategy: {
        primaryMetric: 'product_direct_roi',
        secondaryMetric: 'product_direct_gmv',
        sort: ['roi_x_gmv_desc'],
      },
      filters: {
        requirePositiveCost: true,
        requirePositiveOrders: true,
      },
      output: {
        topCount: 6,
        highlightCount: 3,
      },
    },
    productSales: {
      label: '单商品销售查询',
      version: 'v1',
      dataScope: ['single'],
      strategy: {
        matchMode: 'product_name_contains',
      },
      output: {
        resultLimit: 1,
      },
    },
    periodicReport: {
      label: '周期报告',
      version: 'v1',
      dataScope: ['ads', 'crowd', 'single'],
      strategy: {
        primaryMetric: 'breakeven_roi',
        secondaryMetric: 'wow_or_mom',
      },
      output: {
        topCrowdCount: 5,
        topProductCount: 5,
      },
    },
    lossReason: {
      label: '亏损原因分析',
      version: 'v1',
      dataScope: ['ads', 'crowd', 'single'],
      strategy: {
        primaryMetric: 'breakeven_roi',
        crowdSort: 'order_cost_desc',
        productSort: 'order_cost_desc',
      },
      output: {
        topCrowdCount: 3,
        topProductCount: 3,
      },
    },
  },
};

let semanticPromise: Promise<GenbiSemanticConfig> | null = null;

async function loadSemanticConfig(): Promise<GenbiSemanticConfig> {
  try {
    const semanticUrl = new URL('../../../assets/data/genbi-semantic.json', import.meta.url);
    const raw = await Deno.readTextFile(semanticUrl);
    const parsed = JSON.parse(raw) as GenbiSemanticConfig;
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_GENBI_SEMANTIC;
    }
    return {
      ...DEFAULT_GENBI_SEMANTIC,
      ...parsed,
    };
  } catch {
    return DEFAULT_GENBI_SEMANTIC;
  }
}

export async function getGenbiSemanticConfig(): Promise<GenbiSemanticConfig> {
  if (!semanticPromise) {
    semanticPromise = loadSemanticConfig();
  }
  return semanticPromise;
}

export async function getGenbiRules() {
  const semantic = await getGenbiSemanticConfig();
  return semantic.rules ?? DEFAULT_GENBI_SEMANTIC.rules ?? {};
}

export type { GenbiSemanticConfig };
