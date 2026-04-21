/**
 * 输入验证工具
 * 前后端共用的输入校验逻辑
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Prompt 输入验证 */
export function validatePromptInput(input: string | null | undefined): ValidationResult {
  const errors: string[] = [];

  if (!input || input.trim().length === 0) {
    errors.push('内容不能为空');
    return { valid: false, errors };
  }

  if (input.length > 5000) {
    errors.push(`内容过长（${input.length} 字符），最大允许 5000 字符`);
  }

  // 过滤控制字符（保留换行和制表符）
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(input)) {
    errors.push('内容包含非法控制字符');
  }

  // 基础 XSS 检测
  if (/<\s*script|javascript\s*:|on\w+\s*=/i.test(input)) {
    errors.push('内容包含潜在的不安全字符');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Prompt 内容清理（去除控制字符） */
export function sanitizePromptInput(input: string): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/** 日期格式验证 */
export function validateDateString(date: string): ValidationResult {
  const errors: string[] = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push('日期格式错误，请使用 YYYY-MM-DD');
    return { valid: false, errors };
  }

  const d = new Date(date);
  if (isNaN(d.getTime())) {
    errors.push('日期无效');
  }

  return { valid: errors.length === 0, errors };
}

/** 报告查询参数验证 */
export function validateReportQuery(params: {
  slug?: string;
  status?: string;
  report_type?: string;
  risk_level?: string;
  tag?: string;
  limit?: string;
  offset?: string;
}): ValidationResult {
  const errors: string[] = [];

  if (params.slug && !/^[a-zA-Z0-9_-]{1,200}$/.test(params.slug)) {
    errors.push('无效的报告标识');
  }

  if (params.status && !['draft', 'published', 'archived'].includes(params.status)) {
    errors.push('无效的状态参数');
  }

  if (params.report_type && !['daily', 'weekly', 'monthly', 'single'].includes(params.report_type)) {
    errors.push('无效的报告类型');
  }

  if (params.risk_level && !['low', 'medium', 'high', 'critical'].includes(params.risk_level)) {
    errors.push('无效的风险等级');
  }

  if (params.tag && !/^[\u4e00-\u9fffA-Za-z0-9_-]{1,100}$/.test(params.tag)) {
    errors.push('无效的标签');
  }

  const limit = params.limit ? parseInt(params.limit, 10) : 20;
  if (isNaN(limit) || limit < 1 || limit > 100) {
    errors.push('limit 参数必须在 1-100 之间');
  }

  const offset = params.offset ? parseInt(params.offset, 10) : 0;
  if (isNaN(offset) || offset < 0) {
    errors.push('offset 参数无效');
  }

  return { valid: errors.length === 0, errors };
}

/** 计划看板参数验证 */
export function validatePlanAction(action: string, body: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!['save_plan', 'save_plans', 'save_activity', 'delete_activity', 'fetch_month_note', 'save_month_note'].includes(action)) {
    errors.push('不支持的操作');
    return { valid: false, errors };
  }

  if (action === 'save_plan' || action === 'save_plans') {
    const dates = action === 'save_plan'
      ? [String(body?.date || '')]
      : Array.isArray(body?.items)
        ? (body.items as Array<Record<string, unknown>>).map(item => String(item?.date || ''))
        : [];

    for (const date of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push('日期格式错误');
        break;
      }
    }
  }

  if (action === 'save_activity' && body?.payload) {
    const payload = body.payload as Record<string, unknown>;
    const name = String(payload?.activity_name || '').trim();
    if (!name) errors.push('活动名称不能为空');
    if (name.length > 100) errors.push('活动名称过长');

    const startDate = String(payload?.start_date || '');
    const endDate = String(payload?.end_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      errors.push('活动日期格式错误');
    } else if (startDate > endDate) {
      errors.push('开始日期不能晚于结束日期');
    }
  }

  return { valid: errors.length === 0, errors };
}
