/**
 * GenBI 意图识别
 *
 * 完全动态化架构（动态规则为唯一真相源）：
 * 1. 所有意图都从数据库 genbi_rule_configs 表读取
 * 2. 不再有任何硬编码的意图定义、正则兜底或关键字纠偏
 * 3. AI 语义分类：调用 MiniMax 理解用户语义，匹配到意图列表
 * 4. AI 调用失败或返回无效意图时，统一返回 { intent: 'unknown', source: 'unsupported' }
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

// ============ AI 语义分类 ============

export async function detectIntentByAI(question: string): Promise<{ intent: string; source: 'ai' | 'unsupported' }> {
  try {
    // 完全动态：所有意图都从数据库加载
    const intentDefs = await loadAllIntentDefinitions();
    const allIntentKeys = new Set<string>(intentDefs.map((d) => String(d.intent)));

    const prompt = buildIntentDetectionPrompt(intentDefs, question);
    // maxTokens 设为 32768（MiniMax 2.7 上限）：意图识别虽只需输出一个词，
    // 但模型是推理型，会先输出长思考块。给足预算可避免截断导致最后一行非意图结论。
    const result = await callMiniMax(prompt, undefined, { maxTokens: 32768 });

    // 先剥离 <think> 思考块，再取最后一行做意图结论
    const stripped = stripThinkBlocks(result);
    const cleaned = stripped.split('\n').filter((line) => line.trim()).pop()?.trim().toLowerCase() ?? '';

    // 直接命中数据库中的意图
    if (allIntentKeys.has(cleaned)) {
      console.log(`[genbi-intent] AI: "${question.slice(0, 40)}" → ${cleaned}`);
      return { intent: cleaned, source: 'ai' };
    }

    // 清洗非法字符后再次尝试命中（例如 AI 输出带引号、冒号、空格）
    const extracted = cleaned.replace(/[^a-z0-9_]/g, '');
    if (extracted && allIntentKeys.has(extracted)) {
      console.log(`[genbi-intent] AI(提取): "${question.slice(0, 40)}" → ${extracted}`);
      return { intent: extracted, source: 'ai' };
    }

    // 完全动态化：AI 输出任何不在数据库中的意图，一律返回 unknown，不做任何正则/关键字兜底
    console.warn(`[genbi-intent] AI 返回无效意图 "${cleaned}"，返回 unknown`);
    return { intent: 'unknown', source: 'unsupported' };
  } catch (error) {
    console.warn('[genbi-intent] AI 调用失败，返回 unknown:', error instanceof Error ? error.message : String(error));
    return { intent: 'unknown', source: 'unsupported' };
  }
}
