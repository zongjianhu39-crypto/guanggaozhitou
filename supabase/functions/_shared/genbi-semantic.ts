type GenbiSemanticConfig = {
  version: string;
  docsSource: string;
  defaults?: Record<string, unknown>;
  rag?: Record<string, unknown>;
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
  rules: {
    crowdBudget: {
      minCostShare: 0.05,
      topCount: 3,
      tableLimit: 10,
    },
    dailyDropReason: {
      topDropCount: 3,
    },
    weakProducts: {
      minFocusPoolSize: 20,
      focusPoolCostCoverage: 0.85,
      topCount: 8,
      highlightCount: 3,
    },
    productPotential: {
      topCount: 6,
      highlightCount: 3,
    },
    periodicReport: {
      topCrowdCount: 5,
      topProductCount: 5,
    },
    lossReason: {
      topCrowdCount: 3,
      topProductCount: 3,
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
