import type { GenbiIntent } from '../_shared/genbi-intent.ts';
import type { GenbiRange } from '../_shared/genbi-time.ts';
import { buildUnsupportedResponse } from '../_shared/genbi-format.ts';
import { answerDynamicRule } from './dynamic.ts';
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

// 注意：INTENT_HANDLERS 已废弃，仅保留用于 getSupportedIntentDefinitions() 生成系统提示词
// 实际的意图处理已完全迁移到动态规则引擎（answerDynamicRule）
const INTENT_LABELS: Partial<Record<GenbiIntent, string>> = {
  crowd_budget: '人群预算建议',
  weak_products: '高花费低回报商品',
  crowd_mix: '老客新客结构',
  product_potential: '冲销售额商品识别',
  product_sales: '单商品销售查询',
  weekly_report: '周报生成',
  monthly_report: '月报生成',
  daily_drop_reason: '昨日花费波动归因',
  loss_reason: '亏损原因分析',
  budget_plan: '预算分配建议',
};

const INTENT_EXAMPLES: Partial<Record<GenbiIntent, string[]>> = {
  crowd_budget: ['哪些具体人群效果好需要增加预算，哪些人群差需要降低预算'],
  weak_products: ['单品广告里哪些商品花费高但回报差'],
  crowd_mix: ['老客和新客的占比情况如何，是否合理'],
  product_potential: ['哪些商品适合冲销售额'],
  product_sales: ['某个商品近期的单品广告销售数据如何'],
  weekly_report: ['帮我整理一下上周的周报需要有近期周环比'],
  monthly_report: ['帮我整理一下上月的月报需要有近期月环比'],
  daily_drop_reason: ['为什么昨日的花费下降了，在人群上有什么变化'],
  loss_reason: ['为什么上周的花费盈亏ROI低于 1 是亏钱的，亏在了哪里'],
  budget_plan: ['如果本月还有 100 万预算，按照目前的情况接下来的费用该怎么花'],
};

export function getSupportedIntentDefinitions() {
  // 从语义配置中读取当前启用的意图列表（只返回 is_active=true 的规则对应的意图）
  // 注意：这里返回的是所有预定义意图，用于系统提示词生成
  // 实际的路由由 dispatchGenbiIntent 根据数据库动态规则决定
  return (Object.keys(INTENT_LABELS) as GenbiIntent[]).map((intent) => ({
    intent,
    label: INTENT_LABELS[intent] || intent,
    examples: INTENT_EXAMPLES[intent] || [],
    supported: true,  // 所有意图都标记为 supported，实际是否可用由动态规则决定
  }));
}

function attachRuleExecutionMeta(result: unknown, meta: Record<string, unknown>): Record<string, unknown> {
  const safe = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const existing = (safe.rule_execution && typeof safe.rule_execution === 'object')
    ? safe.rule_execution as Record<string, unknown>
    : {};
  safe.rule_execution = { ...existing, ...meta };
  return safe;
}

export async function dispatchGenbiIntent(intent: GenbiIntent | string, context: GenbiHandlerContext) {
  // 策略：仅使用数据库中的动态规则，不再降级到硬编码 handler

  // 判断动态规则返回是否为"空数据"状态。空数据特征：没有 tables 或 tables内所有 rows 都为空。
  function isEmptyDynamicResult(result: unknown): boolean {
    if (!result || typeof result !== 'object') return true;
    const obj = result as Record<string, unknown>;
    const tables = Array.isArray(obj.tables) ? obj.tables : [];
    if (!tables.length) return true;
    return tables.every((t) => {
      const table = t && typeof t === 'object' ? t as Record<string, unknown> : {};
      const rows = Array.isArray(table.rows) ? table.rows : [];
      return rows.length === 0;
    });
  }

  try {
    const semantic = await getGenbiSemanticConfig();
    const intentRules = semantic.intentRules || {};
    const rules = semantic.rules || {};

    const ruleKey = String(intentRules[intent] || '').trim();
    if (ruleKey && rules[ruleKey]) {
      console.log(`[registry] using dynamic rule from database for intent: ${intent}, ruleKey: ${ruleKey}`);
      const dynamicResult = await answerDynamicRule(intent, context) as Record<string, unknown>;

      // 动态规则返回空数据时，直接返回 unsupported 响应
      if (isEmptyDynamicResult(dynamicResult)) {
        console.warn(`[registry] dynamic rule produced empty result for intent: ${intent}, ruleKey: ${ruleKey}`);
        return buildUnsupportedResponse(
          `动态规则 ${ruleKey} 过滤后无数据，请在 genbi-rule-admin 页面放宽 filters 或检查 dataScope。`,
          context.semanticVersion,
        );
      }

      // 动态路径本身已根据规则的 strategy.metrics / output.topCount 构造列，
      // 这里不再经过 applyRuleOutputConfig 的白名单裁剪（后者是给硬编码 handler 补齐的补丁），
      // 避免新增指标时列被静默丢弃。
      return attachRuleExecutionMeta(dynamicResult, {
        source: 'dynamic',
        ruleKey,
        intent,
      });
    }
  } catch (error) {
    console.warn('[registry] dynamic rule engine failed:', error);
    return buildUnsupportedResponse(
      `动态规则引擎执行失败（${error instanceof Error ? error.message : String(error)}），请检查规则配置或联系管理员。`,
      context.semanticVersion,
    );
  }

  // 数据库中找不到动态规则配置，返回 unsupported
  return buildUnsupportedResponse(
    `这个问题当前没有配置动态规则。请在 genbi-rule-admin 页面为意图 "${intent}" 配置规则后重试。`,
    context.semanticVersion,
  );
}
