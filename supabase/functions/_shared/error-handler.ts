/**
 * 统一错误处理工具
 * 生产环境隐藏内部细节，只返回用户友好消息
 * 详细错误自动打到 Supabase 日志
 */

export type ErrorContext = 'ai-analysis' | 'ai-prompt-admin' | 'dashboard-data' | 'ai-reports' | 'genbi-query' | 'plan-dashboard-summary' | 'feishu-auth';

const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  'ai-analysis': 'AI 分析失败，请稍后重试',
  'ai-prompt-admin': 'Prompt 管理请求失败，请稍后重试',
  'dashboard-data': '数据查询失败，请稍后重试',
  'ai-reports': '报告查询失败，请稍后重试',
  'genbi-query': 'GenBI 查询失败，请稍后重试',
  'plan-dashboard-summary': '计划看板查询失败，请刷新页面后重试',
  'feishu-auth': '飞书认证失败，请稍后重试',
};

export function createErrorResponse(error: unknown, context: ErrorContext): Response {
  // 详细错误打到日志（开发者可见）
  const logDetail = error instanceof Error
    ? { message: error.message, stack: error.stack, name: error.name }
    : { message: String(error) };

  console.error(`[${context}] Error:`, logDetail);

  // 生产环境返回用户友好消息
  const isProd = Deno.env.get('ENV') === 'production' || Deno.env.get('SUPABASE_URL');
  const userMessage = isProd
    ? (USER_FRIENDLY_MESSAGES[context] ?? '系统繁忙，请稍后重试')
    : (error instanceof Error ? error.message : String(error));

  return new Response(JSON.stringify({
    success: false,
    error: userMessage,
    ...(isProd ? {} : { detail: logDetail.message }),
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 用于需要自定义 HTTP 状态码的场景 */
export function createErrorResponseWithStatus(
  error: unknown,
  context: ErrorContext,
  status: number,
  customHeaders?: Record<string, string>
): Response {
  console.error(`[${context}] Error (status=${status}):`, error instanceof Error ? error.message : String(error));

  const isProd = Deno.env.get('ENV') === 'production' || Deno.env.get('SUPABASE_URL');
  const userMessage = isProd
    ? (USER_FRIENDLY_MESSAGES[context] ?? '系统繁忙，请稍后重试')
    : (error instanceof Error ? error.message : String(error));

  return new Response(JSON.stringify({
    success: false,
    error: userMessage,
    ...(isProd ? {} : { detail: error instanceof Error ? error.message : String(error) }),
  }), {
    status,
    headers: { 'Content-Type': 'application/json', ...customHeaders },
  });
}
