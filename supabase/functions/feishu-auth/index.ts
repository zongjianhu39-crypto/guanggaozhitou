// Supabase Edge Function: feishu-auth
// 用途：用 code 换取飞书 user_access_token

import { issuePromptAdminSession } from '../_shared/prompt-admin-auth.ts';

const FEISHU_APP_ID = Deno.env.get('FEISHU_APP_ID') ?? 'cli_a93911f3a9ba5bd1';
const FEISHU_APP_SECRET = Deno.env.get('FEISHU_APP_SECRET') ?? '';

function pickFirstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function resolveUserIdentity(userTokenData: Record<string, unknown>, userInfoData: Record<string, unknown>) {
  const openId = pickFirstNonEmpty(userInfoData.open_id, userTokenData.open_id);
  if (openId) {
    return { id: openId, type: 'open_id' };
  }

  const userId = pickFirstNonEmpty(userInfoData.user_id, userTokenData.user_id);
  if (userId) {
    return { id: userId, type: 'user_id' };
  }

  const unionId = pickFirstNonEmpty(userInfoData.union_id, userTokenData.union_id);
  if (unionId) {
    return { id: unionId, type: 'union_id' };
  }

  const sub = pickFirstNonEmpty(userInfoData.sub, userTokenData.sub);
  if (sub) {
    return { id: sub, type: 'sub' };
  }

  const email = pickFirstNonEmpty(userInfoData.email, userTokenData.email);
  if (email) {
    return { id: email.toLowerCase(), type: 'email' };
  }

  return { id: '', type: 'missing' };
}

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

Deno.serve(async (req) => {
  const headers = getCorsHeaders(req);

  // 处理 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    const { code } = await req.json();

    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
      throw new Error('缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET 环境变量');
    }

    if (!code) {
      return new Response(
        JSON.stringify({ error: '缺少 code 参数' }),
        { status: 400, headers }
      );
    }

    // 第一步：获取 app_access_token
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET
      })
    });
    const tokenData = await tokenRes.json();

    if (tokenData.code !== 0) {
      throw new Error(tokenData.msg || '获取 app_access_token 失败');
    }

    const appAccessToken = tokenData.app_access_token;

    // 第二步：用 code 换取 user_access_token
    const userRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + appAccessToken
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code
      })
    });
    const userData = await userRes.json();

    if (userData.code !== 0) {
      throw new Error(userData.msg || '获取 user_access_token 失败');
    }

    const tokenPayload = userData.data || {};
    const userAccessToken = tokenPayload.access_token;

    // 第三步：获取用户信息
    const infoRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: {
        'Authorization': 'Bearer ' + userAccessToken
      }
    });
    const infoData = await infoRes.json();

    if (infoData.code !== 0) {
      throw new Error(infoData.msg || '获取用户信息失败');
    }

    const infoPayload = infoData.data || {};
    const identity = resolveUserIdentity(tokenPayload, infoPayload);
    if (!identity.id) {
      throw new Error('飞书登录成功，但未返回可用的用户标识');
    }

    const user = {
      name: pickFirstNonEmpty(infoPayload.name, tokenPayload.name),
      en_name: pickFirstNonEmpty(infoPayload.en_name, tokenPayload.en_name),
      avatar_url: pickFirstNonEmpty(infoPayload.avatar_url, infoPayload.picture, tokenPayload.avatar_url, tokenPayload.picture),
      open_id: identity.id,
      union_id: pickFirstNonEmpty(infoPayload.union_id, tokenPayload.union_id),
      email: pickFirstNonEmpty(infoPayload.email, tokenPayload.email),
      identity_type: identity.type,
    };

    const promptAdminSession = await issuePromptAdminSession({
      open_id: user.open_id,
      email: user.email,
      name: user.name,
    });

    // 返回用户信息
    return new Response(
      JSON.stringify({
        success: true,
        user,
        login_debug: {
          identity_type: identity.type,
          token_has_open_id: Boolean(tokenPayload.open_id),
          info_has_open_id: Boolean(infoPayload.open_id),
          token_has_user_id: Boolean(tokenPayload.user_id),
          info_has_user_id: Boolean(infoPayload.user_id),
          token_has_union_id: Boolean(tokenPayload.union_id),
          info_has_union_id: Boolean(infoPayload.union_id),
          token_has_sub: Boolean(tokenPayload.sub),
          info_has_sub: Boolean(infoPayload.sub),
          token_has_email: Boolean(tokenPayload.email),
          info_has_email: Boolean(infoPayload.email),
        },
        prompt_admin: promptAdminSession,
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('[feishu-auth] error:', error.message || error);
    return new Response(
      JSON.stringify({ error: '飞书登录失败，请稍后重试' }),
      { status: 500, headers }
    );
  }
});
