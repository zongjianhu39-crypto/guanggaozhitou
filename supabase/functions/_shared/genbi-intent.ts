/**
 * GenBI 意图识别
 *
 * 完全动态化架构：
 * 1. 所有意图都从数据库 genbi_rule_configs 表读取
 * 2. 不再有任何硬编码的意图定义
 * 3. AI 语义分类：调用 MiniMax 理解用户语义，匹配到意图列表
 * 4. 正则回退：AI 调用失败或返回无效意图时，回退到关键词正则匹配
 */

import { callMiniMax } from './minimax-client.ts';
import { listGenbiRuleConfigRecords } from './genbi-rule-store.ts';

export type GenbiIntent = string;  // 完全动态，不再限制为固定枚举

// ============ 意图列表定义（全部从数据库动态加载） ============

type IntentDefinition = { intent: string; label: string; desc: string; examples: string[] };

async function loadAllIntentDefinitions(): Promise<IntentDefinition[]> {
  const definitions: IntentDefinition[] = [];
  
  try {
    const records = await listGenbiRuleConfigRecords();
    
    for (const record of records) {
      const config = (record.config || {}) as Record<string, unknown>;
      const intentKey = String(config.intentKey || '').trim();
      
      if (!intentKey) continue;  // 没有关联意图的规则，不参与意图识别
      
      const label = String(record.label || config.label || intentKey);
      const desc = String(config.description || label);
      const examples = Array.isArray(config.examples)
        ? (config.examples as unknown[]).map(v => String(v)).filter(Boolean)
        : [label];
      
      definitions.push({ intent: intentKey, label, desc, examples });
    }
  } catch (error) {
    console.warn('[genbi-intent] 加载数据库意图失败：', error instanceof Error ? error.message : String(error));
  }
  
  return definitions;
}

// ============ AI 意图分类 Prompt ============

function buildIntentDetectionPrompt(intentDefs: IntentDefinition[], question: string): string {
  const intentList = intentDefs
    .map((d) => {
      const examplesText = d.examples && d.examples.length > 0
        ? `。示例：${d.examples.slice(0, 5).join('、')}`
        : '';
      return `- ${d.intent}：${d.label}。${d.desc}${examplesText}`;
    })
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
 * AI 常见误判纠正：
 * 1) budget_plan → crowd_budget：问题明确带"人群 + 预算增减"维度时。
 * 2) unknown → 正则兜底：AI 误判为 unknown 但正则能识别，以正则结果为准。
 * 3) 已知 AI 爱用但不在白名单的近似意图名（如 crowd_budget_advice）。
 */
function correctMisclassification(intent: string, question: string): string {
  const normalized = question.replace(/\s+/g, '');
  const looksLikeCrowdBudget = /哪些.*人群.*(增加预算|降低预算|预算|加预算|降预算)/.test(normalized);

  if ((intent === 'budget_plan' || intent === 'unknown') && looksLikeCrowdBudget) {
    console.log(`[genbi-intent] 纠正 AI 误判: ${intent} → crowd_budget`);
    return 'crowd_budget';
  }

  // AI 可能吐出近似但非白名单的 intent，做前缀/关键字规则纠偏
  if (typeof intent === 'string' && intent !== 'unknown') {
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

export async function detectIntentByAI(question: string): Promise<{ intent: string; source: 'ai' | 'regex' }> {
  try {
    // 完全动态：所有意图都从数据库加载
    const intentDefs = await loadAllIntentDefinitions();
    const allIntentKeys = new Set<string>(intentDefs.map((d) => String(d.intent)));

    const prompt = buildIntentDetectionPrompt(intentDefs, question);
    // maxTokens 提到 128：MiniMax-M2.7 需要为 <think> 留足预算，
    // 否则极易截断导致最后一行不是真正的意图结论。
    const result = await callMiniMax(prompt, undefined, { maxTokens: 128 });

    // 先剥离 <think> 思考块，再取最后一行做意图结论
    const stripped = stripThinkBlocks(result);
    const cleaned = stripped.split('\n').filter((line) => line.trim()).pop()?.trim().toLowerCase() ?? '';

    // 正则兜底结果，用于不可信 AI 输出时作为可靠 fallback
    const regexIntent = detectIntentByRegex(question);

    if (allIntentKeys.has(cleaned)) {
      const corrected = correctMisclassification(cleaned, question);
      console.log(`[genbi-intent] AI: "${question.slice(0, 40)}" → ${corrected}${corrected !== cleaned ? ` (纠正自 ${cleaned})` : ''}`);
      return { intent: corrected, source: 'ai' };
    }

    const extracted = cleaned.replace(/[^a-z0-9_]/g, '');
    if (allIntentKeys.has(extracted)) {
      const corrected = correctMisclassification(extracted, question);
      console.log(`[genbi-intent] AI(提取): "${question.slice(0, 40)}" → ${corrected}${corrected !== extracted ? ` (纠正自 ${extracted})` : ''}`);
      return { intent: corrected, source: 'ai' };
    }

    // 仅当 AI 吐出的 snake_case 意图经纠偏后命中数据库中的意图，才接受；
    // 否则回退到正则兜底，避免凭空产生不支持的自定义意图。
    if (extracted && /^[a-z][a-z0-9_]{1,63}$/.test(extracted)) {
      const corrected = correctMisclassification(extracted, question);
      if (typeof corrected === 'string' && allIntentKeys.has(corrected)) {
        console.log(`[genbi-intent] AI 近似意图纠偏: "${question.slice(0, 40)}" → ${corrected} (原始 ${extracted})`);
        return { intent: corrected, source: 'ai' };
      }
      console.warn(`[genbi-intent] AI 自定义意图 "${extracted}" 不在数据库中，回退正则 → ${regexIntent}`);
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

export function detectIntentByRegex(question: string): string {
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
