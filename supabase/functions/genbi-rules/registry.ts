import type { GenbiIntent } from '../_shared/genbi-intent.ts';
import type { GenbiRange } from '../_shared/genbi-time.ts';
import { getLastMonthRange, getLastWeekRange, getYesterdayRange } from '../_shared/genbi-time.ts';
import { buildUnsupportedResponse } from '../_shared/genbi-format.ts';
import { answerCrowdBudget, answerCrowdMix, answerDailyDropReason } from './crowd.ts';
import { answerWeakProducts, answerProductPotential, answerProductSales } from './product.ts';
import { answerPeriodicReport, answerLossReason } from './report.ts';
import { answerDynamicRule } from './dynamic.ts';
import { applyRuleOutputConfig } from '../_shared/genbi-rule-resolver.ts';
import { getGenbiSemanticConfig } from '../_shared/genbi-semantic.ts';

type GenbiHandlerContext = {
  question: string;
  range: GenbiRange;
  semanticVersion: string;
};

type GenbiHandler = (context: GenbiHandlerContext) => Promise<unknown>;

type GenbiHandlerDefinition = {
  label: string;
  examples: string[];
  handler?: GenbiHandler;
  unsupportedReason?: string;
};

const INTENT_HANDLERS: Partial<Record<GenbiIntent, GenbiHandlerDefinition>> = {
  crowd_budget: {
    label: '人群预算建议',
    examples: ['哪些具体人群效果好需要增加预算，哪些人群差需要降低预算'],
    handler: ({ range }) => answerCrowdBudget(range),
  },
  weak_products: {
    label: '高花费低回报商品',
    examples: ['单品广告里哪些商品花费高但回报差'],
    handler: ({ range }) => answerWeakProducts(range),
  },
  crowd_mix: {
    label: '老客新客结构',
    examples: ['老客和新客的占比情况如何，是否合理'],
    handler: ({ range }) => answerCrowdMix(range),
  },
  product_potential: {
    label: '冲销售额商品识别',
    examples: ['哪些商品适合冲销售额'],
    handler: ({ range }) => answerProductPotential(range),
  },
  product_sales: {
    label: '单商品销售查询',
    examples: ['某个商品近期的单品广告销售数据如何'],
    handler: ({ question, range }) => answerProductSales(question, range),
  },
  weekly_report: {
    label: '周报生成',
    examples: ['帮我整理一下上周的周报需要有近期周环比'],
    handler: () => answerPeriodicReport('weekly_report', getLastWeekRange()),
  },
  monthly_report: {
    label: '月报生成',
    examples: ['帮我整理一下上月的月报需要有近期月环比'],
    handler: () => answerPeriodicReport('monthly_report', getLastMonthRange()),
  },
  daily_drop_reason: {
    label: '昨日花费波动归因',
    examples: ['为什么昨日的花费下降了，在人群上有什么变化'],
    handler: () => answerDailyDropReason(getYesterdayRange()),
  },
  loss_reason: {
    label: '亏损原因分析',
    examples: ['为什么上周的花费盈亏ROI低于 1 是亏钱的，亏在了哪里'],
    handler: () => answerLossReason(getLastWeekRange()),
  },
  budget_plan: {
    label: '预算分配建议',
    examples: ['如果本月还有 100 万预算，按照目前的情况接下来的费用该怎么花'],
    unsupportedReason: '预算分配建议需要先接入更完整的约束条件，例如渠道上限、商品库存、投放目标和利润阈值。第一版暂不自动给出预算排布。',
  },
};

function buildSupportedIntentHint() {
  const supported = Object.values(INTENT_HANDLERS)
    .filter((definition) => definition?.handler)
    .map((definition) => definition?.label)
    .filter(Boolean);
  return supported.join(' / ');
}

export function getSupportedIntentDefinitions() {
  return Object.entries(INTENT_HANDLERS)
    .filter(([, definition]) => Boolean(definition))
    .map(([intent, definition]) => ({
      intent,
      label: definition!.label,
      examples: [...definition!.examples],
      supported: Boolean(definition!.handler),
    }));
}

export async function dispatchGenbiIntent(intent: GenbiIntent | string, context: GenbiHandlerContext) {
  // 策略：优先使用数据库中的动态规则，fallback 到专用 handler
  
  // 1. 先检查数据库中是否有动态规则配置
  try {
    const semantic = await getGenbiSemanticConfig();
    const intentRules = semantic.intentRules || {};
    const rules = semantic.rules || {};
    
    const ruleKey = String(intentRules[intent] || '').trim();
    if (ruleKey && rules[ruleKey]) {
      console.log(`[registry] using dynamic rule from database for intent: ${intent}, ruleKey: ${ruleKey}`);
      const result = await answerDynamicRule(intent, context);
      return await applyRuleOutputConfig(intent as GenbiIntent, result);
    }
  } catch (error) {
    console.warn('[registry] dynamic rule engine failed, falling back to hardcoded handler:', error);
  }

  // 2. 数据库中没有，回退到硬编码的专用 handler（向后兼容）
  const definition = INTENT_HANDLERS[intent as GenbiIntent];
  if (definition?.handler) {
    console.log(`[registry] using hardcoded handler for intent: ${intent}`);
    const result = await definition.handler(context);
    return await applyRuleOutputConfig(intent as GenbiIntent, result);
  }
  
  // 3. 检查是否是预定义的不支持意图
  if (definition?.unsupportedReason) {
    return buildUnsupportedResponse(definition.unsupportedReason, context.semanticVersion);
  }

  // 4. 都没有命中，返回不支持
  return buildUnsupportedResponse(
    `这个问题当前没有命中第一版受控问题集。我只会基于真实数据回答广告投放相关问题；当前稳定支持的方向是：${buildSupportedIntentHint()}。`,
    context.semanticVersion,
  );
}
