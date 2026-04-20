// test commit to trigger supabase edge function deploy
import { PROMPT_VARIABLE_SECTIONS } from '../ai-analysis/prompt-templates.ts';
import { requirePromptAdminToken } from '../_shared/prompt-admin-auth.ts';
import {
  getPromptTemplateDetail,
  publishPromptVersion,
  rollbackPromptVersion,
  saveDraftPromptVersion,
} from '../_shared/prompt-store.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

async function authenticateRequest(req: Request) {
  const token = req.headers.get('x-prompt-admin-token') ?? '';
  return requirePromptAdminToken(token);
}

function buildTemplateResponse(detail: NonNullable<Awaited<ReturnType<typeof getPromptTemplateDetail>>>) {
  return {
    template: detail.template,
    published_version: detail.publishedVersion,
    drafts: detail.drafts,
    history: detail.history,
    variables: PROMPT_VARIABLE_SECTIONS,
  };
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const admin = await authenticateRequest(req);

    if (req.method === 'GET') {
      const requestUrl = new URL(req.url);
      const templateKey = requestUrl.searchParams.get('template_key') || 'daily';
      const detail = await getPromptTemplateDetail(templateKey);
      if (!detail) {
        return new Response(JSON.stringify({ success: false, error: 'Prompt 管理数据表尚未初始化' }), {
          status: 404,
          headers: CORS_HEADERS,
        });
      }

      return new Response(JSON.stringify({
        success: true,
        ...buildTemplateResponse(detail),
        editor_identity: {
          open_id: admin.sub,
          email: admin.email,
          name: admin.name,
        },
      }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: '仅支持 GET / POST 请求' }), {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    const body = await req.json();
    const action = String(body.action ?? '');
    const templateKey = String(body.template_key ?? 'daily');
    const createdBy = admin.email || admin.sub;
    const createdByName = admin.name || admin.email || admin.sub;

    if (action === 'save_draft') {
      const version = await saveDraftPromptVersion({
        templateKey,
        content: String(body.content ?? ''),
        changeNote: body.change_note ? String(body.change_note) : null,
        versionId: body.version_id ? String(body.version_id) : null,
        basedOnVersionId: body.based_on_version_id ? String(body.based_on_version_id) : null,
        createdBy,
        createdByName,
      });
      const detail = await getPromptTemplateDetail(templateKey);

      return new Response(JSON.stringify({
        success: true,
        action,
        version,
        ...(detail ? buildTemplateResponse(detail) : {}),
      }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    if (action === 'publish_version') {
      const versionId = String(body.version_id ?? '');
      if (!versionId) {
        return new Response(JSON.stringify({ success: false, error: '缺少 version_id' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      const version = await publishPromptVersion(versionId);
      const detail = await getPromptTemplateDetail(templateKey);
      return new Response(JSON.stringify({
        success: true,
        action,
        version,
        ...(detail ? buildTemplateResponse(detail) : {}),
      }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    if (action === 'rollback_version') {
      const versionId = String(body.version_id ?? '');
      if (!versionId) {
        return new Response(JSON.stringify({ success: false, error: '缺少 version_id' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      const version = await rollbackPromptVersion({
        versionId,
        templateKey,
        changeNote: body.change_note ? String(body.change_note) : null,
        createdBy,
        createdByName,
      });
      const detail = await getPromptTemplateDetail(templateKey);
      return new Response(JSON.stringify({
        success: true,
        action,
        version,
        ...(detail ? buildTemplateResponse(detail) : {}),
      }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    return new Response(JSON.stringify({ success: false, error: `未知 action: ${action}` }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : '';
    const isAuthError = rawMessage.includes('无效或已过期');
    const isPermError = rawMessage.includes('权限');
    const status = isAuthError ? 401 : isPermError ? 403 : 500;
    const clientMessage = isAuthError ? '无效或已过期的 Prompt 管理令牌'
      : isPermError ? '没有 Prompt 管理权限'
      : 'Prompt 管理请求失败，请稍后重试';
    if (status === 500) console.error('[ai-prompt-admin] error:', rawMessage);
    return new Response(JSON.stringify({ success: false, error: clientMessage }), {
      status,
      headers: CORS_HEADERS,
    });
  }
});