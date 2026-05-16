type DimensionRule = {
  label: string;
  exact?: string[];
  prefixes?: string[];
  includes?: string[];
  subRules?: DimensionRule[];
};

type DimensionConfig = {
  fallbackLabel?: string;
  defaultLabel?: string;
  rules: DimensionRule[];
};

type DashboardSpec = {
  version: string;
  docsSource: string;
  metrics?: {
    adsFormulaRows?: Array<{
      key: string;
      label: string;
      formula: string;
    }>;
  };
  dimensions: {
    crowdLayer: DimensionConfig;
    planType: DimensionConfig;
  };
};

const DEFAULT_DASHBOARD_SPEC: DashboardSpec = {
  version: '2026-04-15',
  docsSource: 'docs/current/报表字段及关系-标准文档.md',
  dimensions: {
    planType: {
      defaultLabel: '直播间投放',
      rules: [
        {
          label: '单品投放',
          includes: ['单品'],
        },
      ],
    },
    crowdLayer: {
      fallbackLabel: '未分类',
      rules: [],
    },
  },
};

let dashboardSpecPromise: Promise<DashboardSpec> | null = null;

function normalizeRule(raw: unknown): DimensionRule | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.label !== 'string' || !candidate.label.trim()) {
    return null;
  }

  const rule: DimensionRule = {
    label: candidate.label.trim(),
  };

  if (Array.isArray(candidate.exact)) {
    rule.exact = candidate.exact.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (Array.isArray(candidate.prefixes)) {
    rule.prefixes = candidate.prefixes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (Array.isArray(candidate.includes)) {
    rule.includes = candidate.includes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (Array.isArray(candidate.subRules)) {
    rule.subRules = candidate.subRules.map(normalizeRule).filter((item): item is DimensionRule => Boolean(item));
  }

  return rule;
}

function normalizeDimensionConfig(raw: unknown, fallback: DimensionConfig): DimensionConfig {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const candidate = raw as Record<string, unknown>;
  const rules = Array.isArray(candidate.rules)
    ? candidate.rules.map(normalizeRule).filter((item): item is DimensionRule => Boolean(item))
    : [];

  return {
    fallbackLabel: typeof candidate.fallbackLabel === 'string' && candidate.fallbackLabel.trim()
      ? candidate.fallbackLabel.trim()
      : fallback.fallbackLabel,
    defaultLabel: typeof candidate.defaultLabel === 'string' && candidate.defaultLabel.trim()
      ? candidate.defaultLabel.trim()
      : fallback.defaultLabel,
    rules: rules.length ? rules : fallback.rules,
  };
}

async function loadDashboardSpec(): Promise<DashboardSpec> {
  try {
    const specUrl = new URL('../../../assets/data/dashboard-spec.json', import.meta.url);
    const raw = await Deno.readTextFile(specUrl);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return {
      version: typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : DEFAULT_DASHBOARD_SPEC.version,
      docsSource: typeof parsed.docsSource === 'string' && parsed.docsSource.trim()
        ? parsed.docsSource.trim()
        : DEFAULT_DASHBOARD_SPEC.docsSource,
      metrics: parsed.metrics && typeof parsed.metrics === 'object' ? parsed.metrics as DashboardSpec['metrics'] : DEFAULT_DASHBOARD_SPEC.metrics,
      dimensions: {
        planType: normalizeDimensionConfig((parsed.dimensions as Record<string, unknown> | undefined)?.planType, DEFAULT_DASHBOARD_SPEC.dimensions.planType),
        crowdLayer: normalizeDimensionConfig((parsed.dimensions as Record<string, unknown> | undefined)?.crowdLayer, DEFAULT_DASHBOARD_SPEC.dimensions.crowdLayer),
      },
    };
  } catch {
    return DEFAULT_DASHBOARD_SPEC;
  }
}

export async function getDashboardSpec(): Promise<DashboardSpec> {
  if (!dashboardSpecPromise) {
    dashboardSpecPromise = loadDashboardSpec();
  }
  return dashboardSpecPromise;
}

function matchesRule(value: string, rule: DimensionRule): string | null {
  if (rule.exact?.some((item) => value === item)) {
    return rule.label;
  }

  if (rule.prefixes?.some((item) => value.startsWith(item))) {
    if (rule.subRules?.length) {
      for (const subRule of rule.subRules) {
        const subMatch = matchesRule(value, subRule);
        if (subMatch) {
          return subMatch;
        }
      }
    }
    return rule.label;
  }

  if (rule.includes?.some((item) => value.includes(item))) {
    return rule.label;
  }

  return null;
}

export function classifyDimensionValue(value: string, config: DimensionConfig): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return config.fallbackLabel || config.defaultLabel || '未知';
  }

  for (const rule of config.rules) {
    const matchedLabel = matchesRule(normalized, rule);
    if (matchedLabel) {
      return matchedLabel;
    }
  }

  return config.fallbackLabel || config.defaultLabel || '未知';
}
