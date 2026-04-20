/**
 * AI 分析 Prompt 模板
 *
 * 架构说明：
 * - 最终发给 AI 的 prompt = 数据范围 + fullDataContext(代码自动生成) + 用户指令(DB模板)
 * - DB 模板只存"指令"部分（角色、分析要求等），数据由代码注入，不依赖占位符
 * - 如果 DB 没有对应模板，使用下方 BUILTIN_INSTRUCTIONS 作为默认指令
 */

export interface AnalysisData {
  dateRange: string;
  fullDataContext: string;
}

export const DEFAULT_PROMPT_VERSION = 'v2-high-spend-ops';

export const PROMPT_TEMPLATE_DEFINITIONS = {
  daily: {
    name: '数据分析',
    description: '数据看板日报 AI 分析模板，面向运营快速复盘与次日动作建议。',
    analysisType: 'daily',
    initialVersionLabel: DEFAULT_PROMPT_VERSION,
  },
  single: {
    name: '单品广告分析',
    description: '单品广告看板 AI 分析模板，面向商品维度效率复盘与投放动作建议。',
    analysisType: 'single',
    initialVersionLabel: 'single-v1',
  },
  memory: {
    name: '长期记忆',
    description: 'AI 助手的长期记忆与背景知识，包含品牌、产品、历史决策等持久信息。',
    analysisType: 'memory',
    initialVersionLabel: 'memory-v1',
  },
  soul: {
    name: '灵魂',
    description: 'AI 助手的核心人格设定、价值观与行为准则，决定 AI 的基础性格。',
    analysisType: 'soul',
    initialVersionLabel: 'soul-v1',
  },
  skills: {
    name: '技能',
    description: 'AI 助手的专项技能指令，如写作风格、分析框架、特定任务的执行规范。',
    analysisType: 'skills',
    initialVersionLabel: 'skills-v1',
  },
  ops: {
    name: '运营业务',
    description: '运营团队编辑的业务需求文档，描述当前阶段的运营目标、策略与执行要点。',
    analysisType: 'ops',
    initialVersionLabel: 'ops-v1',
  },
  redlines: {
    name: '业务红线',
    description: '明确列出 AI 绝对不能做的事、不能输出的内容、不能触碰的边界，作为最高优先级约束。',
    analysisType: 'redlines',
    initialVersionLabel: 'redlines-v1',
  },
} as const;

export const PROMPT_VARIABLE_SECTIONS = [
  {
    title: '基础信息',
    items: [
      { key: 'dateRange', label: '数据范围' },
    ],
  },
  {
    title: '核心投放数据',
    items: [
      { key: 'totalCost', label: '总花费' },
      { key: 'totalAmount', label: '总成交金额' },
      { key: 'totalOrders', label: '总成交笔数' },
      { key: 'roi', label: 'ROI' },
      { key: 'directRoi', label: '直接 ROI' },
      { key: 'breakevenRoi', label: '盈亏平衡 ROI' },
      { key: 'returnRoi', label: '去退 ROI' },
      { key: 'returnRate', label: '退货率' },
      { key: 'viewCost', label: '观看成本' },
      { key: 'orderCost', label: '订单成本' },
      { key: 'adOrderRatio', label: '广告成交占比' },
    ],
  },
  {
    title: '财务数据',
    items: [
      { key: 'finRevenue', label: '业务口径收入' },
      { key: 'finProfit', label: '毛利' },
      { key: 'finMargin', label: '毛利率' },
    ],
  },
] as const;

// 所有指令内容 100% 来自 DB（prompt-admin 编辑），代码不硬编码任何默认指令
export const BUILTIN_INSTRUCTIONS: Record<string, string> = {};
export const PROMPT_TEMPLATES = BUILTIN_INSTRUCTIONS;

/**
 * 组装最终发给 AI 的 prompt
 * 结构：数据范围 → 完整数据 → DB 模板指令
 */
export function buildPrompt(
  data: AnalysisData,
  _templateKey: string = 'daily',
  instructions?: string | null,
): string {
  const parts = [
    `【数据范围】${data.dateRange}`,
    '',
    data.fullDataContext,
  ];

  const inst = (instructions ?? '').trim();
  if (inst) {
    parts.push('', inst);
  }

  return parts.join('\n');
}
