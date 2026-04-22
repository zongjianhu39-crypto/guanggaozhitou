import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { createErrorResponse } from '../_shared/error-handler.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL, getSupabaseHeaders } from '../_shared/supabase-client.ts';
import { validatePromptInput } from '../_shared/input-validator.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';

type GenbiRange = {
  start?: string;
  end?: string;
};

type GenbiReference = {
  sourceType?: string;
  title?: string;
  summary?: string;
  pointer?: string;
};

type GenbiTable = {
  title?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
};

type GenbiResult = {
  intent?: string;
  title?: string;
  answer?: string;
  range?: GenbiRange | null;
  tables?: GenbiTable[];
  references?: GenbiReference[];
  notes?: string[];
};

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function isValidDateString(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sanitizePlainText(value: unknown): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripMarkdown(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^[\-\d.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSummary(answer: string): string {
  const cleaned = stripMarkdown(sanitizePlainText(answer));
  if (!cleaned) return 'GenBI 保存的经营问数结果';
  return cleaned.slice(0, 140);
}

function normalizeRange(range: GenbiRange | null | undefined): Required<GenbiRange> {
  const start = isValidDateString(range?.start) ? String(range?.start) : '';
  const end = isValidDateString(range?.end) ? String(range?.end) : start;
  const today = new Date().toISOString().slice(0, 10);
  return {
    start: start || today,
    end: end || start || today,
  };
}

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function buildReportTitle(result: GenbiResult, range: Required<GenbiRange>): string {
  const baseTitle = String(result.title || '').trim() || 'GenBI 洞察';
  if (range.start && range.end) {
    return range.start === range.end
      ? `${range.end} ${baseTitle}`
      : `${range.start} 至 ${range.end} ${baseTitle}`;
  }
  return baseTitle;
}

async function buildReportSlug(result: GenbiResult, question: string, range: Required<GenbiRange>): Promise<string> {
  const intent = slugify(String(result.intent || 'genbi'));
  const questionHash = await shortHash(`${question}|${range.start}|${range.end}|${intent}`);
  return `genbi-${intent || 'query'}-${range.start}-${range.end}-${questionHash}`;
}

function normalizeTables(tables: unknown): GenbiTable[] {
  return Array.isArray(tables)
    ? tables.map((table) => ({
        title: String((table as GenbiTable)?.title || '结果表'),
        columns: Array.isArray((table as GenbiTable)?.columns) ? (table as GenbiTable).columns!.map((item) => String(item)) : [],
        rows: Array.isArray((table as GenbiTable)?.rows) ? (table as GenbiTable).rows! : [],
      }))
    : [];
}

function normalizeReferences(references: unknown): GenbiReference[] {
  return Array.isArray(references)
    ? references.map((reference) => ({
        sourceType: String((reference as GenbiReference)?.sourceType || ''),
        title: String((reference as GenbiReference)?.title || '参考来源'),
        summary: String((reference as GenbiReference)?.summary || ''),
        pointer: String((reference as GenbiReference)?.pointer || ''),
      }))
    : [];
}

function normalizeNotes(notes: unknown): string[] {
  return Array.isArray(notes)
    ? notes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

async function insertAiReportRun(payload: Record<string, unknown>): Promise<string | null> {
  const response = await fetch(`${SB_URL}/rest/v1/ai_report_runs`, {
    method: 'POST',
    headers: {
      ...getSupabaseHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`写入 ai_report_runs 失败: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  return rows?.[0]?.id ?? null;
}

async function upsertAiReport(payload: Record<string, unknown>): Promise<{ id: string | null; slug: string | null }> {
  const response = await fetch(`${SB_URL}/rest/v1/ai_reports?on_conflict=slug`, {
    method: 'POST',
    headers: {
      ...getSupabaseHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`写入 ai_reports 失败: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  return {
    id: rows?.[0]?.id ?? null,
    slug: rows?.[0]?.slug ?? null,
  };
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: '仅支持 POST 请求' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const auth = await authenticateEdgeRequest(req, {
      allowPromptAdmin: true,
      allowSupabaseUser: true,
    });
    if (!auth) {
      return new Response(JSON.stringify({ success: false, error: '未登录' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'Supabase 环境变量缺失' }), {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    const body = await req.json();
    const question = String(body?.question || '').trim();
    const sourceChannel = String(body?.source_channel || 'genbi').trim() || 'genbi';
    const result = (body?.result || {}) as GenbiResult;

    if (!question) {
      return new Response(JSON.stringify({ success: false, error: '缺少原始问题' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const validation = validatePromptInput(question);
    if (!validation.valid) {
      return new Response(JSON.stringify({ success: false, error: `输入无效: ${validation.errors.join('，')}` }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (!result || typeof result !== 'object') {
      return new Response(JSON.stringify({ success: false, error: '缺少可保存的分析结果' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const answer = sanitizePlainText(result.answer || '');
    const intent = String(result.intent || '').trim();
    if (!answer || !intent || intent === 'unsupported') {
      return new Response(JSON.stringify({ success: false, error: '当前结果不支持保存到洞察中心' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const range = normalizeRange(result.range);
    const summary = buildSummary(answer);
    const slug = await buildReportSlug(result, question, range);
    const reportTitle = buildReportTitle(result, range);
    const tags = ['genbi', intent];
    const rawPayload = {
      schema_version: 'genbi-v1',
      source: {
        channel: sourceChannel,
        question,
        intent,
        range,
      },
      article: {
        markdown: answer,
      },
      artifacts: {
        tables: normalizeTables(result.tables),
        charts: [],
        references: normalizeReferences(result.references),
        notes: normalizeNotes(result.notes),
      },
    };

    const createdBy = auth.type === 'prompt_admin'
      ? String(auth.payload?.email || auth.payload?.sub || '')
      : String(auth.user?.email || auth.user?.id || '');

    const runId = await insertAiReportRun({
      analysis_type: 'genbi',
      source_tab: 'genbi',
      source_channel: sourceChannel,
      source_question: question,
      source_intent: intent,
      source_range: range,
      start_date: range.start,
      end_date: range.end,
      status: 'completed',
      title: reportTitle,
      summary,
      risk_level: 'medium',
      model_name: 'GenBI',
      overview_metrics: {},
      report_payload: rawPayload,
      input_snapshot: {
        question,
        title: result.title || '',
        intent,
        range,
      },
      raw_markdown: answer,
      raw_response: answer,
      created_by: createdBy,
    });

    const upserted = await upsertAiReport({
      run_id: runId,
      slug,
      title: reportTitle,
      report_type: 'genbi',
      source_channel: sourceChannel,
      source_question: question,
      source_intent: intent,
      source_range: range,
      report_date: range.end,
      start_date: range.start,
      end_date: range.end,
      status: 'published',
      visibility: 'team',
      summary,
      risk_level: 'medium',
      executive_summary: {
        headline: summary,
      },
      overview_metrics: {},
      highlights: [],
      high_spend_crowds: [],
      actions: [],
      finance_adjustment: {},
      live_session_insight: {},
      tags,
      raw_markdown: answer,
      raw_payload: rawPayload,
      published_at: new Date().toISOString(),
      created_by: createdBy,
    });

    return new Response(JSON.stringify({
      success: true,
      report_id: upserted.id,
      report_slug: upserted.slug,
      report_type: 'genbi',
    }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return createErrorResponse(error, 'save-insight-report');
  }
});
