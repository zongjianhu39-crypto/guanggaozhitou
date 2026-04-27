import { SB_SERVICE_ROLE_KEY, SB_URL } from './supabase-client.ts';

export type GenbiRuleConfigRecord = {
  id: string;
  rule_key: string;
  label: string;
  config: Record<string, unknown>;
  is_active: boolean;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

class GenbiRuleStoreError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'GenbiRuleStoreError';
    this.status = status;
    this.body = body;
  }
}

function buildRestUrl(table: string): URL {
  return new URL(`${SB_URL}/rest/v1/${table}`);
}

function getHeaders(extraHeaders: Record<string, string> = {}) {
  return {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    Accept: 'application/json',
    ...extraHeaders,
  };
}

async function requestRows<T>(url: URL, init: RequestInit = {}): Promise<T[]> {
  if (!SB_SERVICE_ROLE_KEY) {
    return [];
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new GenbiRuleStoreError(`请求 ${url.pathname} 失败`, response.status, body);
  }
  if (response.status === 204) return [];

  const text = await response.text();
  if (!text) return [];
  const payload = JSON.parse(text);
  return Array.isArray(payload) ? payload as T[] : [payload as T];
}

function isMissingRuleTable(error: unknown): boolean {
  return error instanceof GenbiRuleStoreError && error.status === 404 && error.body.includes('PGRST205');
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('规则配置必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

function validateRuleKey(ruleKey: string): string {
  const normalized = String(ruleKey || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{1,64}$/.test(normalized)) {
    throw new Error('规则 key 格式无效');
  }
  return normalized;
}

export async function listGenbiRuleConfigRecords(): Promise<GenbiRuleConfigRecord[]> {
  try {
    const url = buildRestUrl('genbi_rule_configs');
    url.searchParams.set('is_active', 'eq.true');
    url.searchParams.set('order', 'rule_key.asc');
    url.searchParams.set('select', 'id,rule_key,label,config,is_active,updated_by,updated_by_name,created_at,updated_at');
    return await requestRows<GenbiRuleConfigRecord>(url, { headers: getHeaders() });
  } catch (error) {
    if (isMissingRuleTable(error)) return [];
    throw error;
  }
}

export async function upsertGenbiRuleConfig(input: {
  ruleKey: string;
  label: string;
  config: unknown;
  updatedBy?: string | null;
  updatedByName?: string | null;
}): Promise<GenbiRuleConfigRecord> {
  const ruleKey = validateRuleKey(input.ruleKey);
  const config = normalizeConfig(input.config);
  const label = String(input.label || config.label || ruleKey).trim();
  if (!label) {
    throw new Error('规则名称不能为空');
  }

  const url = buildRestUrl('genbi_rule_configs');
  url.searchParams.set('on_conflict', 'rule_key');
  const rows = await requestRows<GenbiRuleConfigRecord>(url, {
    method: 'POST',
    headers: getHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify({
      rule_key: ruleKey,
      label,
      config: {
        ...config,
        label,
      },
      is_active: true,
      updated_by: input.updatedBy ?? null,
      updated_by_name: input.updatedByName ?? null,
    }),
  });

  if (!rows[0]) {
    throw new Error('规则保存失败');
  }
  return rows[0];
}

export async function deactivateGenbiRuleConfig(ruleKey: string): Promise<boolean> {
  const normalized = validateRuleKey(ruleKey);

  const url = buildRestUrl('genbi_rule_configs');
  url.searchParams.set('rule_key', `eq.${normalized}`);

  const rows = await requestRows<GenbiRuleConfigRecord>(url, {
    method: 'PATCH',
    headers: getHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({
      is_active: false,
    }),
  });

  return rows.length > 0;
}

export function mergeGenbiRulesWithRecords(
  baseRules: Record<string, unknown>,
  records: GenbiRuleConfigRecord[],
): Record<string, unknown> {
  const merged = { ...baseRules };
  for (const record of records) {
    const ruleKey = validateRuleKey(record.rule_key);
    const existing = merged[ruleKey] && typeof merged[ruleKey] === 'object'
      ? merged[ruleKey] as Record<string, unknown>
      : {};
    merged[ruleKey] = {
      ...existing,
      ...normalizeConfig(record.config),
      label: record.label || String((record.config as Record<string, unknown>).label || ruleKey),
    };
  }
  return merged;
}
