import { createClient } from 'npm:@supabase/supabase-js@2';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
const TABLE = 'user_config';

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** 从认证结果中提取用户标识 */
function userId(auth: Awaited<ReturnType<typeof authenticateEdgeRequest>> | null): string | null {
  if (!auth) return null;
  if (auth.type === 'prompt_admin') {
    return String(auth.payload?.sub || auth.payload?.user_id || '');
  }
  return String(auth.user?.id || auth.user?.email || '');
}

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  // 认证
  const auth = await authenticateEdgeRequest(req, {
    allowPromptAdmin: true,
    allowSupabaseUser: true,
  });
  if (!auth) {
    return json({ error: '未登录' }, 401, headers);
  }

  const uid = userId(auth);
  if (!uid) {
    return json({ error: '无法识别用户身份' }, 401, headers);
  }

  const client = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

  // GET：读取配置
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const key = url.searchParams.get('key') || '';
    if (!key) {
      return json({ error: '缺少 key 参数' }, 400, headers);
    }

    const { data, error } = await client
      .from(TABLE)
      .select('config_value, updated_at')
      .eq('user_id', uid)
      .eq('config_key', key)
      .maybeSingle();

    if (error) {
      console.error('[user-config] 读取失败:', error);
      return json({ error: '读取配置失败' }, 500, headers);
    }

    return json({
      key,
      value: data?.config_value ?? null,
      updated_at: data?.updated_at ?? null,
    }, 200, headers);
  }

  // POST：保存配置
  if (req.method === 'POST') {
    let body: { key?: string; value?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: '请求体不是有效 JSON' }, 400, headers);
    }

    const key = String(body?.key || '').trim();
    if (!key) {
      return json({ error: '缺少 key 字段' }, 400, headers);
    }

    const value = body?.value ?? {};

    const { error } = await client
      .from(TABLE)
      .upsert(
        {
          user_id: uid,
          config_key: key,
          config_value: value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,config_key' },
      );

    if (error) {
      console.error('[user-config] 保存失败:', error);
      return json({ error: '保存配置失败' }, 500, headers);
    }

    return json({ key, saved: true }, 200, headers);
  }

  return json({ error: '不支持的请求方法' }, 405, headers);
});
