import { getSupabaseHeaders, SB_URL } from './supabase-rest.ts';

export async function insertAiReportRun(payload: Record<string, unknown>): Promise<string | null> {
  try {
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
      const errorText = await response.text();
      console.error(`[ai-analysis] 写入 ai_report_runs 失败: ${response.status} ${errorText}`);
      return null;
    }
    const rows = await response.json();
    return rows?.[0]?.id ?? null;
  } catch (error) {
    console.error('[ai-analysis] 写入 ai_report_runs 异常', error);
    return null;
  }
}

export async function upsertAiReport(
  payload: Record<string, unknown>,
): Promise<{ id: string | null; slug: string | null; error: string | null }> {
  try {
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
      const errorText = await response.text();
      console.error(`[ai-analysis] 写入 ai_reports 失败: ${response.status} ${errorText}`);
      return { id: null, slug: null, error: errorText.slice(0, 800) };
    }

    const rows = await response.json();
    return {
      id: rows?.[0]?.id ?? null,
      slug: rows?.[0]?.slug ?? null,
      error: null,
    };
  } catch (error) {
    console.error('[ai-analysis] 写入 ai_reports 异常', error);
    const message = error instanceof Error ? error.message : String(error);
    return { id: null, slug: null, error: message.slice(0, 800) };
  }
}
