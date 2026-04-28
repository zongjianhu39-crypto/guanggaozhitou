import { SB_SERVICE_ROLE_KEY, SB_URL } from './supabase-client.ts';

export type GenbiQueryEventInput = {
  intent?: string | null;
  ruleKey?: string | null;
  source?: string | null;
  primaryMetric?: string | null;
  secondaryMetric?: string | null;
  originalCount?: number | null;
  filteredCount?: number | null;
  fallbackReason?: string | null;
  latencyMs?: number | null;
  aiEnhanced?: boolean | null;
  questionPrefix?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  semanticVersion?: string | null;
};

/**
 * 将 GenBI 问数埋点异步写入 public.genbi_query_events。
 *
 * 设计原则：
 * - 失败只打印日志，不抛异常，不影响主流程
 * - SB_URL / SB_SERVICE_ROLE_KEY 缺失时直接跳过
 * - 调用方应使用 `void insertGenbiQueryEvent(...)` 形式，不阻塞响应
 */
export async function insertGenbiQueryEvent(event: GenbiQueryEventInput): Promise<void> {
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return;

  const payload: Record<string, unknown> = {
    intent: event.intent ?? null,
    rule_key: event.ruleKey ?? null,
    source: event.source ?? null,
    primary_metric: event.primaryMetric ?? null,
    secondary_metric: event.secondaryMetric ?? null,
    original_count: event.originalCount ?? null,
    filtered_count: event.filteredCount ?? null,
    fallback_reason: event.fallbackReason ?? null,
    latency_ms: event.latencyMs ?? null,
    ai_enhanced: event.aiEnhanced ?? null,
    question_prefix: event.questionPrefix ?? null,
    range_start: event.rangeStart ?? null,
    range_end: event.rangeEnd ?? null,
    semantic_version: event.semanticVersion ?? null,
  };

  try {
    const url = new URL(`${SB_URL}/rest/v1/genbi_query_events`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[genbi-event-store] insert failed status=${response.status}: ${body.slice(0, 160)}`);
    }
  } catch (error) {
    console.warn('[genbi-event-store] insert error:', error instanceof Error ? error.message : String(error));
  }
}
