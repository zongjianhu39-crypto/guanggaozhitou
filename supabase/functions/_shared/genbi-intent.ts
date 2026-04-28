/**
 * GenBI 意图识别
 *
 * 两层策略：
 * 1. AI 语义分类（默认）：调用 MiniMax 理解用户语义，匹配到意图列表
 * 2. 正则回退：AI 调用失败或返回无效意图时，回退到关键词正则匹配
 */

import { callMiniMax } from './minimax-client.ts';
import { listGenbiRuleConfigRecords } from './genbi-rule-store.ts';

export type GenbiIntent =
  | 'crowd_budget'
  | 'weak_products'
  | 'crowd_mix'
  | 'product_potential'
  | 'product_sales'
  | 'weekly_report'
  | 'monthly_report'
  | 'daily_drop_reason'
  | 'loss_reason'
  | 'budget_plan'
  | 'unknown';

// ============ 意图列表定义（发给 AI 的"菜单"） ============

export const INTENT_DEFINITIONS: Array<{ intent: GenbiIntent; label: string; desc: string; examples: string[] }> = [
  {
    intent: 'crowd_budget',
    label: '人群预算建议',
    desc: '用户想了解哪些人群投放效率好应该加预算、哪些人群效率差应该降预算，或想看人群效率排名、人群表现对比',
    examples: ['哪些人群该加预算', '人群效率排名', '哪些人群在浪费钱', '人群投放效果怎么样'],
  },
  {
    intent: 'weak_products',
    label: '高花费低回报商品',
    desc: '用户想找出花费高但回报差、效果不好的商品，或想看哪些商品在亏钱',
    examples: ['哪些商品花费高回报差', '哪些商品在浪费钱', '帮我找亏钱的商品', '哪些商品效果不好'],
  },
  {
    intent: 'crowd_mix',
    label: '老客新客结构',
    desc: '用户想了解老客、新客、兴趣新客的花费占比、人群结构是否合理',
    examples: ['老客新客占比', '人群结构怎么样', '新客和老客的比例', '人群分布情况'],
  },
  {
    intent: 'product_potential',
    label: '冲销售额商品识别',
    desc: '用户想找出适合冲销售额、值得加大投入的商品',
    examples: ['哪些商品适合冲销售额', '哪些商品值得投', '哪些商品有潜力'],
  },
  {
    intent: 'product_sales',
    label: '单商品销售查询',
    desc: '用户想查某个具体商品的销售表现、近期数据、广告投放情况',
    examples: ['某商品近期销售数据', '这个商品表现怎么样', '商品广告效果'],
  },
  {
    intent: 'weekly_report',
    label: '周报生成',
    desc: '用户想要上周或某周的投放周报、周环比、周总结',
    examples: ['帮我整理上周周报', '这周投放情况总结', '周报'],
  },
  {
    intent: 'monthly_report',
    label: '月报生成',
    desc: '用户想要上月或某月的投放月报、月环比、月总结',
    examples: ['帮我整理上月月报', '这个月表现怎么样', '月报'],
  },
  {
    intent: 'daily_drop_reason',
    label: '花费波动归因',
    desc: '用户想了解某天或某段时间花费下降、变化的原因，在人群上有什么波动',
    examples: ['为什么昨日花费下降了', '今天花费怎么变少了', '花费波动原因'],
  },
  {
    intent: 'loss_reason',
    label: '亏损原因分析',
    desc: '用户想知道为什么亏钱、ROI为什么低于1、亏损出在哪里',
    examples: ['为什么ROI低于1', '亏在了哪里', '亏损原因是什么', '为什么在亏钱'],
  },
  {
    intent: 'budget_plan',
    label: '预算分配建议',
    desc: '用户想知道预算怎么分配、怎么花、如何优化预算',
    examples: ['预算怎么分配', '100万怎么花', '预算怎么优化'],
  },
  {
    intent: 'unknown',
    label: '不支持的提问',
    desc: '与广告投放数据无关的问题，或无法归类到以上任何意图的问题',
    examples: ['今天吃什么', '帮我写个作文'],
  },
];

const VALID_INTENTS = new Set<string>(INTENT_DEFINITIONS.map((d) => d.intent));

// ============ 数据库动态意图合并 ============

type IntentDefinition = { intent: GenbiIntent | string; label: string; desc: string; examples: string[] };

async function buildIntentDefinitionsWithDynamic(): Promise<IntentDefinition[]> {
  const base: IntentDefinition[] = INTENT_DEFINITIONS.map((d) => ({ ...d, examples: [...d.examples] }));
  try {
    const records = await listGenbiRuleConfigRecords();
    const knownKeys = new Set<string>(base.map((d) => String(d.intent)));
    for (const record of records) {
      const config = (record.config || {}) as Record<string, unknown>;
      const intentKey = String(config.intentKey || '').trim();
      if (!intentKey) continue;
      // 与内置重复的 intentKey 沿用内置 label；完全新的自定义意图才追加到菜单。
      if (knownKeys.has(intentKey)) continue;
      const label = String(record.label || config.label || intentKey);
      const desc = String((config as Record<string, unknown>).description || label);
      const examples = Array.isArray((config as Record<string, unknown>).examples)
        ? ((config as Record<string, unknown>).examples as unknown[]).map((v) => String(v)).filter(Boolean)
        : [label];
      
      base.push({ intent: intentKey, label, desc, examples });
      knownKeys.add(intentKey);
    }
  } catch (error) {
    console.warn('[genbi-intent] 加载数据库动态意图失败，仅使用内置菜单：', error instanceof Error ? error.message : String(error));
  }
  return base;
}

// ============ AI 意图分类 Prompt ============

function buildIntentDetectionPrompt(question: string, intentDefs?: IntentDefinition[]): string {
  const defs = intentDefs ?? INTENT_DEFINITIONS;
  const intentList = defs
    .filter((d) => d.intent !== 'unknown')
    .map((d) => `- ${d.intent}：${d.label}。${d.desc}`)
    .join('\n');

  return `你是一个意图分类器。根据用户的提问，从以下意图列表中选择最匹配的一个意图。

意图列表：
${intentList}

如果用户的问题与广告投放数据无关，或无法归类到以上任何意图，返回 unknown。

规则：
- 只返回意图名称（如 crowd_budget），不要任何解释或标点
- 如果问题涉及多个意图，选择用户最关心的那个
- 如果问题含糊不清，选择最相关的意图

用户提问：${question}`;
}

// ============ AI 输出清洗 ============

/**
 * MiniMax-M2.7 是推理模型，会先输出 <think>...</think> 块再给结论。
 * 意图识别只关心最终结论，必须先剥离思考过程，避免 maxTokens 截断时
 * 把 <think> 内的中间文本当成意图。
 */
function stripThinkBlocks(text: string): string {
  return String(text || '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/<think[\s\S]*$/i, '') // 未闭合的 think 尾块（被 maxTokens 截断的情形）
    .replace(/<\/?think>/gi, '')
    .replace(/```think[\s\S]*?```/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .trim();
}

// ============ AI 常见误判纠正 ============

/**
 * 规则引擎/硬编码 handler 真正支持的意图白名单。
 * 如果 AI 输出的意图不在此白名单，一律视为不可信并回退到正则兜底，
 * 避免 "自定义意图" 被静默采纳后命中 unsupported fallback。
 */
const SUPPORTED_INTENT_WHITELIST = new Set<GenbiIntent>([
  'crowd_budget',
  'weak_products',
  'crowd_mix',
  'product_potential',
  'product_sales',
  'weekly_report',
  'monthly_report',
  'daily_drop_reason',
  'loss_reason',
  'budget_plan',
]);

/**
 * AI 常见误判纠正：
 * 1) budget_plan → crowd_budget：问题明确带"人群 + 预算增减"维度时。
 * 2) unknown → 正则兜底：AI 误判为 unknown 但正则能识别，以正则结果为准。
 * 3) 已知 AI 爱用但不在白名单的近似意图名（如 crowd_budget_advice）。
 */
function correctMisclassification(intent: GenbiIntent | string, question: string): GenbiIntent | string {
  const normalized = question.replace(/\s+/g, '');
  const looksLikeCrowdBudget = /哪些.*人群.*(增加预算|降低预算|预算|加预算|降预算)/.test(normalized);

  if ((intent === 'budget_plan' || intent === 'unknown') && looksLikeCrowdBudget) {
    console.log(`[genbi-intent] 纠正 AI 误判: ${intent} → crowd_budget`);
    return 'crowd_budget';
  }

  // AI 可能吐出近似但非白名单的 intent，做前缀/关键字规则纠偏
  if (typeof intent === 'string' && !SUPPORTED_INTENT_WHITELIST.has(intent as GenbiIntent) && intent !== 'unknown') {
    if (intent.includes('crowd') && intent.includes('budget')) return 'crowd_budget';
    if (intent.includes('weak') || intent.includes('low_roi')) return 'weak_products';
    if (intent.includes('crowd') && (intent.includes('mix') || intent.includes('structure'))) return 'crowd_mix';
    if (intent.includes('potential') || intent.includes('gmv_boost')) return 'product_potential';
    if (intent.includes('product_sales') || intent.includes('sku_sales')) return 'product_sales';
    if (intent.includes('weekly') || intent.includes('week_report')) return 'weekly_report';
    if (intent.includes('monthly') || intent.includes('month_report')) return 'monthly_report';
    if (intent.includes('drop') || intent.includes('daily_')) return 'daily_drop_reason';
    if (intent.includes('loss') || intent.includes('roi_below')) return 'loss_reason';
    if (intent.includes('budget')) return 'budget_plan';
  }
  return intent;
}

// ============ AI 语义分类 ============

export async function detectIntentByAI(question: string): Promise<{ intent: GenbiIntent | string; source: 'ai' | 'regex' }> {
  try {
    // 合并数据库动态意图，让管理后台添加的新 intentKey 能被 AI 看到。
    const intentDefs = await buildIntentDefinitionsWithDynamic();
    const dynamicKeys = new Set<string>(intentDefs.map((d) => String(d.intent)));

    const prompt = buildIntentDetectionPrompt(question, intentDefs);
    // maxTokens 提到 128：MiniMax-M2.7 需要为 <think> 留足预算，
    // 否则极易截断导致最后一行不是真正的意图结论。
    const result = await callMiniMax(prompt, undefined, { maxTokens: 128 });

    // 先剥离 <think> 思考块，再取最后一行做意图结论
    const stripped = stripThinkBlocks(result);
    const cleaned = stripped.split('\n').filter((line) => line.trim()).pop()?.trim().toLowerCase() ?? '';

    // 正则兜底结果，用于不可信 AI 输出时作为可靠 fallback
    const regexIntent = detectIntentByRegex(question);

    if (VALID_INTENTS.has(cleaned) || dynamicKeys.has(cleaned)) {
      const corrected = correctMisclassification(cleaned as GenbiIntent, question);
      console.log(`[genbi-intent] AI: "${question.slice(0, 40)}" → ${corrected}${corrected !== cleaned ? ` (纠正自 ${cleaned})` : ''}`);
      return { intent: corrected, source: 'ai' };
    }

    const extracted = cleaned.replace(/[^a-z0-9_]/g, '');
    if (VALID_INTENTS.has(extracted) || dynamicKeys.has(extracted)) {
      const corrected = correctMisclassification(extracted as GenbiIntent, question);
      console.log(`[genbi-intent] AI(提取): "${question.slice(0, 40)}" → ${corrected}${corrected !== extracted ? ` (纠正自 ${extracted})` : ''}`);
      return { intent: corrected, source: 'ai' };
    }

    // 仅当 AI 吐出的 snake_case 意图经纠偏后命中白名单，才接受；
    // 否则回退到正则兜底，避免凭空产生不支持的自定义意图。
    if (extracted && /^[a-z][a-z0-9_]{1,63}$/.test(extracted)) {
      const corrected = correctMisclassification(extracted, question);
      if (typeof corrected === 'string' && (SUPPORTED_INTENT_WHITELIST.has(corrected as GenbiIntent) || dynamicKeys.has(corrected))) {
        console.log(`[genbi-intent] AI 近似意图纠偏: "${question.slice(0, 40)}" → ${corrected} (原始 ${extracted})`);
        return { intent: corrected, source: 'ai' };
      }
      console.warn(`[genbi-intent] AI 自定义意图 "${extracted}" 不在白名单，回退正则 → ${regexIntent}`);
      return { intent: regexIntent, source: 'regex' };
    }

    console.warn(`[genbi-intent] AI 返回无效意图 "${cleaned}"，回退正则 → ${regexIntent}`);
    return { intent: regexIntent, source: 'regex' };
  } catch (error) {
    console.warn('[genbi-intent] AI 调用失败，回退正则:', error instanceof Error ? error.message : String(error));
    return { intent: detectIntentByRegex(question), source: 'regex' };
  }
}

// ============ 正则匹配（回退方案） ============

export function detectIntentByRegex(question: string): GenbiIntent {
  const normalized = question.replace(/\s+/g, '');
  if (/哪些.*人群.*(增加预算|降低预算|预算|加预算|降预算)/.test(normalized)) return 'crowd_budget';
  if (/单品广告.*哪些.*商品.*花费.*(回报差|差|低)/.test(normalized)) return 'weak_products';
  if (/老客.*新客.*占比/.test(normalized)) return 'crowd_mix';
  if (/哪些.*商品.*适合.*冲销售额/.test(normalized)) return 'product_potential';
  if (/商品.*(销售数据|表现如何|近期.*如何)/.test(normalized)) return 'product_sales';
  if (/上周.*周报|周报/.test(normalized)) return 'weekly_report';
  if (/上月.*月报|月报/.test(normalized)) return 'monthly_report';
  if (/(昨日|昨天).*花费.*下降/.test(normalized)) return 'daily_drop_reason';
  if (/盈亏.*ROI.*低于?1|亏钱.*亏在了哪里/.test(normalized)) return 'loss_reason';
  if (/(100万|预算).*(怎么花|怎么分配|如何花)/.test(normalized)) return 'budget_plan';
  return 'unknown';
}

/** 向后兼容：同步正则匹配（保留给不需要 AI 的场景） */
export function detectIntent(question: string): GenbiIntent {
  return detectIntentByRegex(question);
}
