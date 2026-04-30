export const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SB_SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  '';

export const SB_URL = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL') ?? 'https://qjscsikithbxuxmjyjsp.supabase.co';

function parseContentRangeTotal(contentRange: string | null): number {
  if (!contentRange) return 0;
  const parts = contentRange.split('/');
  if (parts.length !== 2) return 0;
  const total = Number.parseInt(parts[1], 10);
  return Number.isFinite(total) ? total : 0;
}

export async function checkDailyRunLimitForUser(userId: string | null) {
  if (!userId) return 0;
  try {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const iso = start.toISOString();
    const url = new URL(`${SB_URL}/rest/v1/ai_report_runs`);
    url.searchParams.set('select', 'id');
    url.searchParams.set('created_by', `eq.${userId}`);
    url.searchParams.set('created_at', `gte.${iso}`);

    const resp = await fetch(url.toString(), {
      headers: {
        ...getSupabaseHeaders(),
        Prefer: 'count=exact',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return 0;
    const total = parseContentRangeTotal(resp.headers.get('content-range'));
    return total;
  } catch (err) {
    console.warn('[ai-analysis] checkDailyRunLimitForUser error', err);
    return 0;
  }
}

export function getSupabaseHeaders() {
  if (!SB_URL) {
    throw new Error('Missing SUPABASE_URL');
  }
  if (!SB_SERVICE_ROLE_KEY) {
    throw new Error(
      'Missing SUPABASE service role key. Please set SUPABASE_SERVICE_ROLE_KEY (preferred) or SB_SERVICE_ROLE_KEY.'
    );
  }
  return {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    Accept: 'application/json',
  };
}

