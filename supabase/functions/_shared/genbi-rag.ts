import type { GenbiIntent } from './genbi-intent.ts';
import type { GenbiRange } from './genbi-time.ts';
import { getGenbiSemanticConfig } from './genbi-semantic.ts';
import { SB_URL, getSupabaseHeaders } from './supabase-client.ts';

type RagReference = {
  sourceType: 'rules_doc' | 'prompt_template' | 'ai_report' | 'ai_playbook';
  title: string;
  summary: string;
  pointer: string;
};

type RagContext = {
  references: RagReference[];
  notes: string[];
};

type RagFetchResult = {
  references: RagReference[];
  failedSource: string | null;
};

const RAG_FETCH_TIMEOUT_MS = Number(Deno.env.get('GENBI_RAG_TIMEOUT_MS') ?? '1800');

const INTENT_KEYWORDS: Partial<Record<GenbiIntent, string[]>> = {
  crowd_budget: ['人群', '预算', '订单成本', '老客', '新客'],
  crowd_mix: ['老客', '新客', '人群', '占比'],
  weak_products: ['单品', '商品', '花费', '回报', '直接ROI', '订单成本'],
  product_potential: ['商品', '销售额', '直接ROI', '成交金额'],
  product_sales: ['商品', '销售', '单品广告'],
  weekly_report: ['周报', '周环比', '盈亏平衡ROI', '重点人群', '重点商品'],
  monthly_report: ['月报', '月环比', '盈亏平衡ROI', '重点人群', '重点商品'],
  daily_drop_reason: ['昨日', '花费下降', '人群', '波动'],
  loss_reason: ['亏损', '盈亏平衡ROI', '订单成本', '花费'],
  budget_plan: ['预算', '分配', '花费'],
};

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function extractKeywords(question: string, intent: GenbiIntent): string[] {
  const base = INTENT_KEYWORDS[intent] || [];
  const text = String(question || '');
  const extracted = Array.from(new Set([
    ...base,
    ...((text.match(/[A-Za-z0-9\u4e00-\u9fa5]{2,20}/g) || [])
      .filter((item) => item.length >= 2)
      .slice(0, 8)),
  ]));
  return extracted;
}

function scoreText(text: string, keywords: string[]): number {
  const normalized = normalizeText(text);
  return keywords.reduce((score, keyword) => {
    return score + (normalized.includes(normalizeText(keyword)) ? 1 : 0);
  }, 0);
}

async function loadRulesDocSnippets(intent: GenbiIntent, question: string): Promise<RagReference[]> {
  const semantic = await getGenbiSemanticConfig();
  const ragConfig = semantic.rag as Record<string, unknown> | undefined;
  const ragSources = ragConfig?.sources as Record<string, any> | undefined;
  const rulesConfig = ragSources?.rulesDocs;
  if (!ragConfig?.enabled || !rulesConfig?.enabled) return [];

  const docs = Array.isArray(rulesConfig.docs) ? rulesConfig.docs : [];
  const keywords = extractKeywords(question, intent);
  const results: RagReference[] = [];

  for (const relativePath of docs) {
    try {
      const docUrl = new URL(`../../../${relativePath}`, import.meta.url);
      const raw = await Deno.readTextFile(docUrl);
      const blocks = raw
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => ({
          text: item.replace(/\s+/g, ' ').trim(),
          score: scoreText(item, keywords),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      blocks.forEach((block) => {
        results.push({
          sourceType: 'rules_doc',
          title: relativePath.split('/').pop() || relativePath,
          summary: block.text.slice(0, 140),
          pointer: relativePath,
        });
      });
    } catch {
      // ignore missing doc file
    }
  }

  return results;
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = RAG_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchReportReferences(intent: GenbiIntent, question: string): Promise<RagReference[]> {
  const semantic = await getGenbiSemanticConfig();
  const ragConfig = semantic.rag as Record<string, unknown> | undefined;
  const ragSources = ragConfig?.sources as Record<string, any> | undefined;
  const reportsConfig = ragSources?.aiReports;
  if (!ragConfig?.enabled || !reportsConfig?.enabled || !SB_URL) return [];

  const limit = Number(reportsConfig.limit || 12);
  const url = new URL(`${SB_URL}/rest/v1/ai_reports`);
  url.searchParams.set('select', 'slug,title,summary,tags,report_type,report_date,start_date,end_date');
  url.searchParams.set('status', 'eq.published');
  url.searchParams.set('order', 'report_date.desc');
  url.searchParams.set('limit', String(limit));

  try {
    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        ...getSupabaseHeaders(),
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`ai_reports lookup failed: ${response.status}`);
    }
    const rows = await response.json();
    const keywords = extractKeywords(question, intent);
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        row,
        score: scoreText([row.title, row.summary, ...(row.tags || [])].join(' '), keywords),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => ({
        sourceType: 'ai_report' as const,
        title: item.row.title || item.row.slug || '历史报告',
        summary: String(item.row.summary || '').slice(0, 140),
        pointer: `ai_reports/${item.row.slug || item.row.id || ''}`,
      }));
  } catch (error) {
    throw error instanceof Error ? error : new Error('ai_reports lookup failed');
  }
}

async function fetchPromptTemplateReferences(intent: GenbiIntent, question: string): Promise<RagReference[]> {
  const semantic = await getGenbiSemanticConfig();
  const ragConfig = semantic.rag as Record<string, unknown> | undefined;
  const ragSources = ragConfig?.sources as Record<string, any> | undefined;
  const promptConfig = ragSources?.promptTemplates;
  if (!ragConfig?.enabled || !promptConfig?.enabled || !SB_URL) return [];

  const limit = Number(promptConfig.limit || 6);
  const url = new URL(`${SB_URL}/rest/v1/ai_prompt_versions`);
  url.searchParams.set(
    'select',
    'id,version_label,content,published_at,template:ai_prompt_templates!inner(template_key,name,description,analysis_type,is_active)',
  );
  url.searchParams.set('status', 'eq.published');
  url.searchParams.set('template.is_active', 'eq.true');
  url.searchParams.set('order', 'published_at.desc');
  url.searchParams.set('limit', String(limit));

  try {
    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        ...getSupabaseHeaders(),
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`prompt template lookup failed: ${response.status}`);
    }
    const rows = await response.json();
    const keywords = extractKeywords(question, intent);
    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const template = row.template || {};
        const score = scoreText([
          template.template_key,
          template.name,
          template.description,
          template.analysis_type,
          row.content,
        ].join(' '), keywords);
        return { row, template, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((item) => ({
        sourceType: 'prompt_template' as const,
        title: `${item.template.name || item.template.template_key || 'Prompt'} · ${item.row.version_label || 'published'}`,
        summary: String(item.template.description || item.row.content || '').replace(/\s+/g, ' ').slice(0, 140),
        pointer: `ai_prompt_templates/${item.template.template_key || item.row.id || ''}`,
      }));
  } catch (error) {
    throw error instanceof Error ? error : new Error('prompt template lookup failed');
  }
}

async function fetchPlaybookReferences(intent: GenbiIntent, question: string): Promise<RagReference[]> {
  const semantic = await getGenbiSemanticConfig();
  const ragConfig = semantic.rag as Record<string, unknown> | undefined;
  const ragSources = ragConfig?.sources as Record<string, any> | undefined;
  const playbooksConfig = ragSources?.aiPlaybooks;
  if (!ragConfig?.enabled || !playbooksConfig?.enabled || !SB_URL) return [];

  const limit = Number(playbooksConfig.limit || 8);
  const url = new URL(`${SB_URL}/rest/v1/ai_playbooks`);
  url.searchParams.set('select', 'slug,title,scenario,priority,expected_outcome,source_tags,notes');
  url.searchParams.set('status', 'eq.active');
  url.searchParams.set('order', 'updated_at.desc');
  url.searchParams.set('limit', String(limit));

  try {
    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        ...getSupabaseHeaders(),
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`ai_playbooks lookup failed: ${response.status}`);
    }
    const rows = await response.json();
    const keywords = extractKeywords(question, intent);
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        row,
        score: scoreText([row.title, row.scenario, row.expected_outcome, ...(row.source_tags || []), row.notes].join(' '), keywords),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 1)
      .map((item) => ({
        sourceType: 'ai_playbook' as const,
        title: item.row.title || item.row.slug || '经验库',
        summary: String(item.row.expected_outcome || item.row.notes || item.row.scenario || '').slice(0, 140),
        pointer: `ai_playbooks/${item.row.slug || item.row.id || ''}`,
      }));
  } catch (error) {
    throw error instanceof Error ? error : new Error('ai_playbooks lookup failed');
  }
}

async function collectRemoteReferences(
  sourceName: string,
  loader: () => Promise<RagReference[]>,
): Promise<RagFetchResult> {
  try {
    return {
      references: await loader(),
      failedSource: null,
    };
  } catch (error) {
    console.warn(`[genbi-rag] ${sourceName} lookup failed`, error);
    return {
      references: [],
      failedSource: sourceName,
    };
  }
}

export async function buildGenbiRagContext(intent: GenbiIntent, question: string, _range: GenbiRange): Promise<RagContext> {
  const semantic = await getGenbiSemanticConfig();
  const ragConfig = semantic.rag as Record<string, unknown> | undefined;
  if (!ragConfig?.enabled) {
    return { references: [], notes: [] };
  }

  const ragSources = ragConfig?.sources as Record<string, any> | undefined;
  const playbooksEnabled = Boolean(ragSources?.aiPlaybooks?.enabled);
  const maxReferences = Number(ragConfig.maxReferences || 5);
  const [rulesDocs, promptTemplates, reports, playbooks] = await Promise.all([
    loadRulesDocSnippets(intent, question),
    collectRemoteReferences('Prompt 模板', () => fetchPromptTemplateReferences(intent, question)),
    collectRemoteReferences('历史报告', () => fetchReportReferences(intent, question)),
    playbooksEnabled
      ? collectRemoteReferences('经验库', () => fetchPlaybookReferences(intent, question))
      : Promise.resolve({ references: [], failedSource: null }),
  ]);

  // Prompt 模板全部引用，不计入 maxReferences 上限
  const otherReferences = rulesDocs
    .concat(reports.references, playbooks.references)
    .slice(0, Math.max(1, maxReferences));
  const references = promptTemplates.references.concat(otherReferences);
  const failedSources = [promptTemplates.failedSource, reports.failedSource, playbooks.failedSource].filter(Boolean);
  const sourceLabels = ['业务规则文档', 'Prompt 管理已发布模板', '历史报告'];
  if (playbooksEnabled) {
    sourceLabels.push('经验库');
  }
  const notes = references.length
    ? [`本次回答额外参考了 ${references.length} 条受控知识：${sourceLabels.join(' / ')}。`]
    : [];
  if (failedSources.length) {
    notes.push(`知识检索本次部分降级：${failedSources.join('、')} 未成功返回，本次回答仅基于当前可用知识源。`);
  }

  return { references, notes };
}

export type { RagReference, RagContext };
