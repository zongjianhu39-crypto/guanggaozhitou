import { requirePromptAdminToken } from '../_shared/prompt-admin-auth.ts';
import { clearGenbiSemanticConfigCache, getGenbiSemanticConfig } from '../_shared/genbi-semantic.ts';
import { listGenbiRuleConfigRecords, upsertGenbiRuleConfig, deactivateGenbiRuleConfig } from '../_shared/genbi-rule-store.ts';
import { createErrorResponseWithStatus } from '../_shared/error-handler.ts';
import { previewDynamicRule } from '../genbi-rules/dynamic.ts';
import { getLastWeekRange } from '../_shared/genbi-time.ts';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

function normalizePreviewRange(raw: unknown): { start: string; end: string; label: string } {
  const safe = asRecord(raw);
  const start = String(safe.start || '').trim();
  const end = String(safe.end || '').trim();
  if (ISO_DATE_RE.test(start) && ISO_DATE_RE.test(end) && start <= end) {
    return { start, end, label: `${start} 至 ${end}` };
  }
  if (start || end) {
    throw new BadRequestError('试跑日期范围无效，请检查开始日期和结束日期');
  }
  return getLastWeekRange();
}

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

async function validateRuleConfigInput(ruleKey: string, config: unknown) {
  const normalizedRuleKey = String(ruleKey || '').trim();
  const safeConfig = asRecord(config);
  const semantic = await getGenbiSemanticConfig();
  const metricKeys = new Set(Object.keys(asRecord(semantic.metrics)));
  const strategy = asRecord(safeConfig.strategy);
  const selectedMetrics = [
    String(strategy.primaryMetric || '').trim(),
    String(strategy.secondaryMetric || '').trim(),
    ...(Array.isArray(strategy.metrics) ? strategy.metrics.map((item) => String(item || '').trim()) : []),
  ].filter(Boolean);
  const invalidMetric = selectedMetrics.find((metric) => !metricKeys.has(metric));
  if (invalidMetric) {
    throw new BadRequestError(`指标 ${invalidMetric} 不在当前指标表中`);
  }

  const intentKey = String(safeConfig.intentKey || '').trim();
  if (!intentKey) return;

  const records = await listGenbiRuleConfigRecords();
  const duplicate = records.find((record) => {
    if (record.rule_key === normalizedRuleKey) return false;
    const recordConfig = asRecord(record.config);
    return String(recordConfig.intentKey || '').trim() === intentKey;
  });
  if (duplicate) {
    throw new BadRequestError(`关联意图 ${intentKey} 已被规则「${duplicate.label || duplicate.rule_key}」使用`);
  }
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

  const rules = Object.entries(asRecord(semantic.rules))
    .filter(([ruleKey]) => {
      // 如果该规则在数据库中存在但 is_active=false，则跳过（软删除）
      const record = recordMap.get(ruleKey);
      if (record && record.is_active === false) {
        return false;
      }
      return true;
    })
    .map(([ruleKey, config]) => {
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
      await validateRuleConfigInput(String(body.rule_key || ''), body.config);
      const saved = await upsertGenbiRuleConfig({
        ruleKey: String(body.rule_key || ''),
        label: String(body.label || ''),
        config: body.config,
        updatedBy: admin.email || admin.sub,
        updatedByName: admin.name || admin.email || admin.sub,
      });
      clearGenbiSemanticConfigCache();

      // 如果配置了 intentKey，需要在语义配置中注册
      const config = body.config || {};
      const intentKey = String(config.intentKey || '').trim();
      if (intentKey) {
        console.log(`[genbi-rule-admin] rule ${body.rule_key} mapped to intent: ${intentKey}`);
      }

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
      await validateRuleConfigInput(ruleKey, config);

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

    if (action === 'preview_rule') {
      const ruleKey = String(body.rule_key || '').trim() || 'preview_rule';
      const config = asRecord(body.config);
      if (!config || Object.keys(config).length === 0) {
        return new Response(JSON.stringify({ success: false, error: '预览时必须提供当前规则配置' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const intentFromBody = String(body.intent || '').trim();
      const intentFromConfig = String((config as any).intentKey || '').trim();
      const intent = intentFromBody || intentFromConfig || ruleKey;
      const range = normalizePreviewRange(body.range);

      const previewStart = Date.now();
      const previewResult = await previewDynamicRule(intent, ruleKey, config, range);
      const durationMs = Date.now() - previewStart;

      return new Response(JSON.stringify({
        success: true,
        action,
        preview: previewResult,
        preview_meta: {
          intent,
          rule_key: ruleKey,
          range,
          duration_ms: durationMs,
        },
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
    if (error instanceof BadRequestError) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 400,
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
