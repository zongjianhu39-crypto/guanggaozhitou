/**
 * GenBI 意图识别
 *
 * 两层策略：
 * 1. AI 语义分类（默认）：调用 MiniMax 理解用户语义，匹配到意图列表
 * 2. 正则回退：AI 调用失败或返回无效意图时，回退到关键词正则匹配
 */

import { callMiniMax } from './minimax-client.ts';

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

// ============ AI 意图分类 Prompt ============

function buildIntentDetectionPrompt(question: string): string {
  const intentList = INTENT_DEFINITIONS
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

// ============ AI 语义分类 ============

export async function detectIntentByAI(question: string): Promise<{ intent: GenbiIntent | string; source: 'ai' | 'regex' }> {
  try {
    const prompt = buildIntentDetectionPrompt(question);
    const result = await callMiniMax(prompt, undefined, { maxTokens: 20 });

    // 清理 AI 返回结果：去空白、去标点、取最后一行
    const cleaned = result.trim().split('\n').pop()?.trim().toLowerCase() ?? '';

    // 尝试直接匹配预定义意图
    if (VALID_INTENTS.has(cleaned)) {
      console.log(`[genbi-intent] AI 识别成功: "${question.slice(0, 40)}" → ${cleaned}`);
      return { intent: cleaned as GenbiIntent, source: 'ai' };
    }

    // AI 可能返回 "意图：crowd_budget" 这样的格式，提取意图名
    const extracted = cleaned.replace(/[^a-z_]/g, '');
    if (VALID_INTENTS.has(extracted)) {
      console.log(`[genbi-intent] AI 识别成功(提取): "${question.slice(0, 40)}" → ${extracted}`);
      return { intent: extracted as GenbiIntent, source: 'ai' };
    }

    // 如果 AI 返回了不在预定义列表中的意图，可能是自定义意图
    // 保留原始返回值，让下游的动态规则引擎处理
    if (extracted && /^[a-z][a-z0-9_]{1,63}$/.test(extracted)) {
      console.log(`[genbi-intent] AI 识别到自定义意图: "${question.slice(0, 40)}" → ${extracted}`);
      return { intent: extracted, source: 'ai' };
    }

    // AI 返回了无效意图，回退到正则
    console.warn(`[genbi-intent] AI 返回无效意图 "${cleaned}"，回退到正则匹配`);
    return { intent: detectIntentByRegex(question), source: 'regex' };
  } catch (error) {
    // AI 调用失败，回退到正则
    console.warn('[genbi-intent] AI 意图识别失败，回退到正则匹配:', error instanceof Error ? error.message : String(error));
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
