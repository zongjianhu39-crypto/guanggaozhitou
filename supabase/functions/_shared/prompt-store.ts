import { PROMPT_TEMPLATE_DEFINITIONS, PROMPT_TEMPLATES } from '../ai-analysis/prompt-templates.ts';

const SB_URL = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL') ?? 'https://qjscsikithbxuxmjyjsp.supabase.co';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SB_SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  '';

export type PromptTemplateRecord = {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  analysis_type: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PromptVersionRecord = {
  id: string;
  template_id: string;
  version_no: number;
  version_label: string;
  status: 'draft' | 'published' | 'archived';
  content: string;
  change_note: string | null;
  based_on_version_id: string | null;
  published_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type PromptTemplateDetail = {
  template: PromptTemplateRecord;
  publishedVersion: PromptVersionRecord | null;
  drafts: PromptVersionRecord[];
  history: PromptVersionRecord[];
};

export type ActivePromptTemplate = {
  templateKey: string;
  versionId: string | null;
  versionLabel: string;
  content: string;
  source: 'database' | 'fallback' | 'override';
};

class PromptStoreError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'PromptStoreError';
    this.status = status;
    this.body = body;
  }
}

function getSupabaseHeaders(extraHeaders: Record<string, string> = {}) {
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    throw new Error('Supabase 环境变量缺失');
  }

  return {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    Accept: 'application/json',
    ...extraHeaders,
  };
}

function buildRestUrl(table: string): URL {
  return new URL(`${SB_URL}/rest/v1/${table}`);
}

async function requestRows<T>(url: URL, init: RequestInit = {}): Promise<T[]> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new PromptStoreError(`请求 ${url.pathname} 失败`, response.status, body);
  }
  if (response.status === 204) {
    return [];
  }
  const text = await response.text();
  if (!text) {
    return [];
  }
  const payload = JSON.parse(text);
  return Array.isArray(payload) ? payload as T[] : [payload as T];
}

function isMissingPromptTable(error: unknown): boolean {
  return error instanceof PromptStoreError && error.status === 404 && error.body.includes('PGRST205');
}

export async function getPromptTemplateByKey(templateKey: string): Promise<PromptTemplateRecord | null> {
  const url = buildRestUrl('ai_prompt_templates');
  url.searchParams.set('template_key', `eq.${templateKey}`);
  url.searchParams.set('limit', '1');
  url.searchParams.set('select', 'id,template_key,name,description,analysis_type,is_active,created_by,created_at,updated_at');
  const rows = await requestRows<PromptTemplateRecord>(url, { headers: getSupabaseHeaders() });
  return rows[0] ?? null;
}

export async function getPromptVersionById(versionId: string): Promise<PromptVersionRecord | null> {
  const url = buildRestUrl('ai_prompt_versions');
  url.searchParams.set('id', `eq.${versionId}`);
  url.searchParams.set('limit', '1');
  url.searchParams.set(
    'select',
    'id,template_id,version_no,version_label,status,content,change_note,based_on_version_id,published_at,created_by,created_by_name,created_at,updated_at'
  );
  const rows = await requestRows<PromptVersionRecord>(url, { headers: getSupabaseHeaders() });
  return rows[0] ?? null;
}

export async function listPromptVersions(templateId: string): Promise<PromptVersionRecord[]> {
  const url = buildRestUrl('ai_prompt_versions');
  url.searchParams.set('template_id', `eq.${templateId}`);
  url.searchParams.set('order', 'version_no.desc');
  url.searchParams.set(
    'select',
    'id,template_id,version_no,version_label,status,content,change_note,based_on_version_id,published_at,created_by,created_by_name,created_at,updated_at'
  );
  return requestRows<PromptVersionRecord>(url, { headers: getSupabaseHeaders() });
}

async function createPromptTemplate(templateKey: string): Promise<PromptTemplateRecord> {
  const definition = PROMPT_TEMPLATE_DEFINITIONS[templateKey as keyof typeof PROMPT_TEMPLATE_DEFINITIONS];
  if (!definition) {
    throw new Error(`未知模板类型: ${templateKey}`);
  }

  const url = buildRestUrl('ai_prompt_templates');
  const rows = await requestRows<PromptTemplateRecord>(url, {
    method: 'POST',
    headers: getSupabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({
      template_key: templateKey,
      name: definition.name,
      description: definition.description,
      analysis_type: definition.analysisType,
      is_active: true,
      created_by: 'system',
    }),
  });

  return rows[0];
}

async function createInitialPromptVersion(template: PromptTemplateRecord): Promise<PromptVersionRecord> {
  const definition = PROMPT_TEMPLATE_DEFINITIONS[template.template_key as keyof typeof PROMPT_TEMPLATE_DEFINITIONS];
  const content = PROMPT_TEMPLATES[template.template_key as keyof typeof PROMPT_TEMPLATES];
  if (!definition || !content) {
    throw new Error(`缺少模板定义: ${template.template_key}`);
  }

  const url = buildRestUrl('ai_prompt_versions');
  const rows = await requestRows<PromptVersionRecord>(url, {
    method: 'POST',
    headers: getSupabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({
      template_id: template.id,
      version_no: 1,
      version_label: definition.initialVersionLabel,
      status: 'published',
      content,
      change_note: '运行时自动补种默认模板。',
      published_at: new Date().toISOString(),
      created_by: 'system',
      created_by_name: 'system',
    }),
  });

  return rows[0];
}

export async function ensurePromptTemplateSeed(templateKey: string): Promise<PromptTemplateDetail | null> {
  try {
    let template = await getPromptTemplateByKey(templateKey);
    if (!template) {
      template = await createPromptTemplate(templateKey);
    }

    let versions = await listPromptVersions(template.id);
    if (!versions.length) {
      const created = await createInitialPromptVersion(template);
      versions = [created];
    }

    const publishedVersion = versions.find((item) => item.status === 'published') ?? null;
    return {
      template,
      publishedVersion,
      drafts: versions.filter((item) => item.status === 'draft'),
      history: versions,
    };
  } catch (error) {
    if (isMissingPromptTable(error)) {
      return null;
    }
    throw error;
  }
}

export async function getPromptTemplateDetail(templateKey: string): Promise<PromptTemplateDetail | null> {
  const seeded = await ensurePromptTemplateSeed(templateKey);
  if (!seeded) {
    return null;
  }

  return {
    template: seeded.template,
    publishedVersion: seeded.publishedVersion,
    drafts: seeded.drafts,
    history: seeded.history,
  };
}

async function getNextVersionNumber(templateId: string): Promise<number> {
  const versions = await listPromptVersions(templateId);
  return versions.length ? Math.max(...versions.map((item) => item.version_no)) + 1 : 1;
}

export async function saveDraftPromptVersion(input: {
  templateKey: string;
  content: string;
  changeNote?: string | null;
  versionId?: string | null;
  basedOnVersionId?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
}): Promise<PromptVersionRecord> {
  const detail = await getPromptTemplateDetail(input.templateKey);
  if (!detail) {
    throw new Error('Prompt 模板尚未初始化');
  }

  const content = input.content.trim();
  if (!content) {
    throw new Error('Prompt 内容不能为空');
  }

  if (input.versionId) {
    const existing = await getPromptVersionById(input.versionId);
    if (!existing) {
      throw new Error('草稿版本不存在');
    }
    if (existing.status !== 'draft') {
      throw new Error('只有草稿版本可以继续编辑');
    }

    const url = buildRestUrl('ai_prompt_versions');
    url.searchParams.set('id', `eq.${existing.id}`);
    const rows = await requestRows<PromptVersionRecord>(url, {
      method: 'PATCH',
      headers: getSupabaseHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify({
        content,
        change_note: input.changeNote ?? existing.change_note,
      }),
    });
    return rows[0];
  }

  const nextVersionNo = await getNextVersionNumber(detail.template.id);
  const versionLabel = `${input.templateKey}-v${nextVersionNo}`;
  const url = buildRestUrl('ai_prompt_versions');
  const rows = await requestRows<PromptVersionRecord>(url, {
    method: 'POST',
    headers: getSupabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({
      template_id: detail.template.id,
      version_no: nextVersionNo,
      version_label: versionLabel,
      status: 'draft',
      content,
      change_note: input.changeNote ?? null,
      based_on_version_id: input.basedOnVersionId ?? detail.publishedVersion?.id ?? null,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    }),
  });
  return rows[0];
}

export async function publishPromptVersion(versionId: string): Promise<PromptVersionRecord> {
  const version = await getPromptVersionById(versionId);
  if (!version) {
    throw new Error('待发布版本不存在');
  }

  if (version.status === 'published') {
    return version;
  }

  const archiveUrl = buildRestUrl('ai_prompt_versions');
  archiveUrl.searchParams.set('template_id', `eq.${version.template_id}`);
  archiveUrl.searchParams.set('status', 'eq.published');
  await requestRows<PromptVersionRecord>(archiveUrl, {
    method: 'PATCH',
    headers: getSupabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify({
      status: 'archived',
    }),
  }).catch((error) => {
    if (!(error instanceof PromptStoreError && error.status === 406)) {
      throw error;
    }
  });

  const publishUrl = buildRestUrl('ai_prompt_versions');
  publishUrl.searchParams.set('id', `eq.${version.id}`);
  const rows = await requestRows<PromptVersionRecord>(publishUrl, {
    method: 'PATCH',
    headers: getSupabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({
      status: 'published',
      published_at: new Date().toISOString(),
    }),
  });

  return rows[0];
}

export async function rollbackPromptVersion(input: {
  versionId: string;
  templateKey: string;
  changeNote?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
}): Promise<PromptVersionRecord> {
  const sourceVersion = await getPromptVersionById(input.versionId);
  if (!sourceVersion) {
    throw new Error('目标历史版本不存在');
  }

  const rollbackDraft = await saveDraftPromptVersion({
    templateKey: input.templateKey,
    content: sourceVersion.content,
    changeNote: input.changeNote ?? `回滚自 ${sourceVersion.version_label}`,
    basedOnVersionId: sourceVersion.id,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
  });

  return publishPromptVersion(rollbackDraft.id);
}

export async function resolveActivePromptTemplate(templateKey: string): Promise<ActivePromptTemplate> {
  const detail = await getPromptTemplateDetail(templateKey);
  if (detail?.publishedVersion) {
    return {
      templateKey,
      versionId: detail.publishedVersion.id,
      versionLabel: detail.publishedVersion.version_label,
      content: detail.publishedVersion.content,
      source: 'database',
    };
  }

  const definition = PROMPT_TEMPLATE_DEFINITIONS[templateKey as keyof typeof PROMPT_TEMPLATE_DEFINITIONS];
  const defaultTemplate = PROMPT_TEMPLATES[templateKey as keyof typeof PROMPT_TEMPLATES];
  if (!definition || !defaultTemplate) {
    throw new Error(`未找到可用 Prompt 模板: ${templateKey}`);
  }

  return {
    templateKey,
    versionId: null,
    versionLabel: definition.initialVersionLabel,
    content: defaultTemplate,
    source: 'fallback',
  };
}
