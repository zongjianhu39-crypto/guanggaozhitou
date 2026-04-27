import { requirePromptAdminToken } from '../_shared/prompt-admin-auth.ts';
import { clearGenbiSemanticConfigCache, getGenbiSemanticConfig } from '../_shared/genbi-semantic.ts';
import { listGenbiRuleConfigRecords, upsertGenbiRuleConfig, deactivateGenbiRuleConfig } from '../_shared/genbi-rule-store.ts';
import { createErrorResponseWithStatus } from '../_shared/error-handler.ts';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getIntentLabels(semantic: Awaited<ReturnType<typeof getGenbiSemanticConfig>>) {
  const labels: Record<string, string> = {};
  const groups = Array.isArray(semantic.intentGroups) ? semantic.intentGroups : [];
  for (const group of groups) {
    const key = String(group.key || '').trim();
    if (key) labels[key] = String(group.label || key);
  }
  return labels;
}

async function buildRuleListResponse() {
  const semantic = await getGenbiSemanticConfig();
  const records = await listGenbiRuleConfigRecords();
  const recordMap = new Map(records.map((record) => [record.rule_key, record]));
  const intentRules = asRecord(semantic.intentRules);
  const intentLabels = getIntentLabels(semantic);
  const ruleIntents: Record<string, Array<{ intent: string; label: string }>> = {};

  Object.entries(intentRules).forEach(([intent, ruleKey]) => {
    const key = String(ruleKey || '').trim();
    if (!key) return;
    if (!ruleIntents[key]) ruleIntents[key] = [];
    ruleIntents[key].push({
      intent,
      label: intentLabels[intent] || intent,
    });
  });

  const rules = Object.entries(asRecord(semantic.rules)).map(([ruleKey, config]) => {
    const safeConfig = asRecord(config);
    const record = recordMap.get(ruleKey);
    return {
      rule_key: ruleKey,
      label: String(safeConfig.label || record?.label || ruleKey),
      config: safeConfig,
      intents: ruleIntents[ruleKey] || [],
      source: record ? 'database' : 'default',
      updated_at: record?.updated_at || null,
      updated_by_name: record?.updated_by_name || null,
    };
  });

  return {
    semantic_version: semantic.version,
    defaults: semantic.defaults || {},
    metrics: semantic.metrics || {},
    sources: semantic.sources || {},
    rules,
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
      return new Response(JSON.stringify({
        success: true,
        ...(await buildRuleListResponse()),
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
    const action = String(body.action || '');

    if (action === 'save_rule') {
      const saved = await upsertGenbiRuleConfig({
        ruleKey: String(body.rule_key || ''),
        label: String(body.label || ''),
        config: body.config,
        updatedBy: admin.email || admin.sub,
        updatedByName: admin.name || admin.email || admin.sub,
      });
      clearGenbiSemanticConfigCache();

      return new Response(JSON.stringify({
        success: true,
        action,
        saved_rule: saved,
        ...(await buildRuleListResponse()),
      }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    if (action === 'create_rule') {
      const ruleKey = String(body.rule_key || '').trim();
      if (!ruleKey) {
        return new Response(JSON.stringify({ success: false, error: '规则 key 不能为空' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      const label = String(body.label || ruleKey).trim();
      const config = body.config || { label, dataScope: [], strategy: {}, output: {} };

      const saved = await upsertGenbiRuleConfig({
        ruleKey,
        label,
        config,
        updatedBy: admin.email || admin.sub,
        updatedByName: admin.name || admin.email || admin.sub,
      });
      clearGenbiSemanticConfigCache();

      return new Response(JSON.stringify({
        success: true,
        action,
        saved_rule: saved,
        ...(await buildRuleListResponse()),
      }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    if (action === 'delete_rule') {
      const ruleKey = String(body.rule_key || '').trim();
      if (!ruleKey) {
        return new Response(JSON.stringify({ success: false, error: '规则 key 不能为空' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      const deleted = await deactivateGenbiRuleConfig(ruleKey);
      if (!deleted) {
        return new Response(JSON.stringify({ success: false, error: '规则不存在或已删除' }), {
          status: 404,
          headers: CORS_HEADERS,
        });
      }

      clearGenbiSemanticConfigCache();

      return new Response(JSON.stringify({
        success: true,
        action,
        deleted_rule_key: ruleKey,
        ...(await buildRuleListResponse()),
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

    if (isAuthError) {
      return new Response(JSON.stringify({ success: false, error: '无效或已过期的 Prompt 管理令牌' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }
    if (isPermError) {
      return new Response(JSON.stringify({ success: false, error: '没有 Prompt 管理权限' }), {
        status: 403,
        headers: CORS_HEADERS,
      });
    }
    return createErrorResponseWithStatus(error, 'genbi-rule-admin', 500, CORS_HEADERS);
  }
});
