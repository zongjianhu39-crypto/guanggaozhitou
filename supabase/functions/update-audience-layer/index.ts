import { createClient } from 'npm:@supabase/supabase-js@2';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
const EXTRA_ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowedOrigins = new Set([PROD_ORIGIN, 'https://www.friends.wang', 'https://friends.wang', ...EXTRA_ALLOWED_ORIGINS]);
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? origin
    : origin === 'null'
      ? 'null'
      : allowedOrigins.has(origin)
        ? origin
        : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405, headers);

  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return json({ error: '缺少 Supabase 环境变量' }, 500, headers);
  }

  const authResult = await authenticateEdgeRequest(req, { allowPromptAdmin: true, allowSupabaseUser: true });
  if (!authResult) return json({ error: '未登录' }, 401, headers);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: '请求体不是合法 JSON' }, 400, headers);

  const audienceName = String(body.audience_name || '').trim();
  const layer = String(body.layer || '').trim();

  if (!audienceName) return json({ error: '缺少 audience_name' }, 400, headers);
  if (!layer) return json({ error: '缺少 layer' }, 400, headers);

  const client = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

  const { error } = await client
    .from('audience_layer_mapping')
    .upsert({ audience_name: audienceName, layer, updated_at: new Date().toISOString() }, { onConflict: 'audience_name' });

  if (error) return json({ error: error.message }, 500, headers);

  return json({ success: true, audience_name: audienceName, layer }, 200, headers);
});
