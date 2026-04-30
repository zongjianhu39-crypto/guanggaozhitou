import type { AnalysisData } from './prompt-templates.ts';

export type MetricBucket = {
  cost: number;
  amount: number;
  orders: number;
  views: number;
  shows: number;
  directAmount: number;
  cart: number;
  preOrders: number;
  interactions: number;
};

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type BudgetDecision = 'increase' | 'observe' | 'reduce';
export type ActionPriority = 'p0' | 'p1' | 'p2';
export type OverallJudgement = 'positive' | 'cautious' | 'negative';

export type CrowdInsight = {
  name: string;
  cost: number;
  costShare: number;
  roi: number;
  orderCost: number;
  orders: number;
  decision: BudgetDecision;
  reason: string;
};

export type SegmentInsight = {
  name: string;
  category: string;
  cost: number;
  costShare: number;
  roi: number;
  orderCost: number;
  decision: BudgetDecision;
  reason: string;
};

export type CostStructureItem = {
  name: string;
  amount: number;
  share: number;
};

export type LiveSessionItem = {
  name: string;
  amount: number;
  views: number;
  orders: number;
  buyerRate: number;
  refundRate: number;
};

export type ProductInsight = {
  productId: string;
  name: string;
  cost: number;
  costShare: number;
  roi: number;
  orderCost: number;
  orders: number;
  amount: number;
  carts: number;
  views: number;
  decision: BudgetDecision;
  reason: string;
};

export type ReportIssue = {
  title: string;
  severity: RiskLevel;
  evidence: string;
  impact: string;
};

export type ReportAction = {
  title: string;
  target: string;
  reason: string;
  priority: ActionPriority;
};

export type StructuredReportPayload = {
  meta: {
    reportType: string;
    startDate: string;
    endDate: string;
    generatedAt: string;
    version: string;
  };
  executiveSummary: {
    headline: string;
    overallJudgement: OverallJudgement;
    riskLevel: RiskLevel;
  };
  overviewMetrics: Record<string, string>;
  highSpendCrowds: CrowdInsight[];
  keySegments: SegmentInsight[];
  financeAdjustment: {
    summary: string;
    costStructure: CostStructureItem[];
    finMargin: string;
    returnRate: string;
  };
  liveSessionInsight: {
    summary: string;
    sessions: LiveSessionItem[];
  };
  issues: ReportIssue[];
  actions: ReportAction[];
  tomorrowFocus: string[];
  tags: string[];
  markdown?: string;
};

export type DailyReportResult = {
  promptData: AnalysisData;
  structuredData: StructuredReportPayload;
  inputSnapshot: Record<string, unknown>;
  reportTitle: string;
  reportSummary: string;
  riskLevel: RiskLevel;
  tags: string[];
};

export type DataRow = Record<string, unknown>;

export type DashboardPayloadLike = {
  ads?: {
    kpi?: DataRow;
    daily?: DataRow[];
  };
  crowd?: {
    summary?: Array<DataRow & { subRows?: DataRow[] }>;
  };
};
