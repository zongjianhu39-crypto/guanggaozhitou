import { getGenbiSemanticConfig } from '../_shared/genbi-semantic.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';
import { detectDateRange } from '../_shared/genbi-time.ts';
import { detectIntent, type GenbiIntent } from '../_shared/genbi-intent.ts';
import { buildGenbiRagContext } from '../_shared/genbi-rag.ts';
import { dispatchGenbiIntent } from '../genbi-rules/registry.ts';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { createErrorResponse } from '../_shared/error-handler.ts';
import { callMiniMax } from '../_shared/minimax-client.ts';
import { resolveActivePromptTemplate, type ActivePromptTemplate } from '../_shared/prompt-store.ts';
import { validatePromptInput } from '../_shared/input-validator.ts';
import { checkRateLimit, createRateLimitResponse } from '../_shared/rate-limiter.ts';

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

// ============ AI 输出清理 ============

function sanitizeAiOutput(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/^(好的，我|好的，|首先，我|根据提供的|让我|下面我|我将|我需要).*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============ 数据上下文构建 ============

/** 将规则引擎的表格数据转成 AI 可读的文本上下文 */
function buildDataContextFromRuleResult(ruleResult: Record<string, unknown>, question: string): string {
  const parts: string[] = [];

  parts.push(`【用户问题】${question}`);

  const ruleAnswer = String(ruleResult.answer || '').trim();
  if (ruleAnswer) {
    parts.push(`\n【系统数据摘要】${ruleAnswer}`);
  }

  const tables = ruleResult.tables as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tables) && tables.length > 0) {
    for (const table of tables) {
      const title = String(table.title || '数据表');
      const columns = table.columns as string[] | undefined;
      const rows = table.rows as Array<Record<string, unknown>> | undefined;

      if (Array.isArray(columns) && Array.isArray(rows) && rows.length > 0) {
        parts.push(`\n【${title}】`);
        parts.push(`| ${columns.join(' | ')} |`);
        parts.push(`| ${columns.map(() => '---').join(' | ')} |`);
        for (const row of rows.slice(0, 20)) {
          const cells = columns.map((col) => String(row[col] ?? '-'));
          parts.push(`| ${cells.join(' | ')} |`);
        }
      }
    }
  }

  const range = ruleResult.range as { start?: string; end?: string; label?: string } | undefined;
  if (range?.start) {
    parts.push(`\n【分析范围】${range.start} 至 ${range.end || range.start}`);
  }

  const highlights = ruleResult.highlights as string[] | undefined;
  if (Array.isArray(highlights) && highlights.length > 0) {
    parts.push(`\n【关键发现】${highlights.join('；')}`);
  }

  const notes = ruleResult.notes as string[] | undefined;
  if (Array.isArray(notes) && notes.length > 0) {
    parts.push(`\n【补充说明】${notes.join('；')}`);
  }

  return parts.join('\n');
}

// ============ Prompt 模板加载 ============

/** 加载 Prompt 模板并组装 system prompt */
async function buildSystemPromptFromTemplates(): Promise<string> {
  const sectionMap: Array<{ label: string; key: string }> = [
    { label: '【灵魂设定】', key: 'soul' },
    { label: '【业务红线】', key: 'redlines' },
    { label: '【长期记忆】', key: 'memory' },
    { label: '【技能指令】', key: 'skills' },
    { label: '【运营业务背景】', key: 'ops' },
  ];

  const sections: string[] = [];

  sections.push('你是广告投放运营分析师，服务于"交个朋友"直播电商团队。你的职责是基于真实数据回答运营团队的经营问题。');

  const results = await Promise.allSettled(
    sectionMap.map(({ key }) => resolveActivePromptTemplate(key))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const { label, key } = sectionMap[i];
    if (result.status === 'fulfilled') {
      const content = result.value.content.trim();
      if (content) {
        sections.push(`${label}\n${content}`);
        console.log(`[genbi-query] prompt template "${key}" loaded`);
      }
    } else {
      console.warn(`[genbi-query] prompt template "${key}" load failed:`, result.reason);
    }
  }

  sections.push([
    '【回答规范】',
    '- 只基于提供的真实数据回答，不编造任何数据',
    '- 给出明确的结论和可执行的行动建议',
    '- 用简洁专业的中文，避免套话',
    '- 如果数据不足以回答，直接说明局限性',
    '- 不要重复"根据提供的数据"等冗余前缀',
  ].join('\n'));

  return sections.join('\n\n');
}

// ============ 主处理逻辑 ============

async function handleIntent(question: string) {
  const semantic = await getGenbiSemanticConfig();
  const intent: GenbiIntent = detectIntent(question);
  const range = detectDateRange(question);

  console.log(`[genbi-query] intent=${intent}, range=${JSON.stringify(range)}, question="${question.slice(0, 80)}"`);

  // 1. 规则引擎：获取结构化数据（表格、高亮等）
  const ruleResult = await dispatchGenbiIntent(intent, {
    question,
    range,
    semanticVersion: semantic.version,
  }) as Record<string, unknown>;

  // 2. unsupported 意图直接返回，不调 AI
  if (intent === 'unknown' || ruleResult.intent === 'unsupported') {
    const ragContext = await buildGenbiRagContext(intent, question, range);
    return {
      ...ruleResult,
      references: ragContext.references,
      notes: [...(Array.isArray(ruleResult.notes) ? (ruleResult.notes as string[]) : []), ...ragContext.notes],
    };
  }

  // 3. 拼装数据上下文
  const dataContext = buildDataContextFromRuleResult(ruleResult, question);

  // 4. 加载 Prompt 模板组装 system prompt
  const systemPrompt = await buildSystemPromptFromTemplates();
  console.log(`[genbi-query] system prompt length=${systemPrompt.length}, data context length=${dataContext.length}`);

  // 5. 调用 MiniMax AI
  let aiAnswer = '';
  try {
    const rawAiResponse = await callMiniMax(dataContext, systemPrompt, { maxTokens: 2048 });
    aiAnswer = sanitizeAiOutput(rawAiResponse);
    console.log(`[genbi-query] AI response received, length=${aiAnswer.length}`);
  } catch (aiError) {
    console.warn('[genbi-query] AI 调用失败，回退到规则引擎回答:', aiError instanceof Error ? aiError.message : String(aiError));
    aiAnswer = String(ruleResult.answer || '');
  }

  // 6. RAG 参考来源
  const ragContext = await buildGenbiRagContext(intent, question, range);

  // 7. 合并：保留规则引擎的表格 + AI 的自然语言分析
  return {
    ...ruleResult,
    answer: aiAnswer || String(ruleResult.answer || ''),
    ai_enhanced: true,
    references: ragContext.references,
    notes: [
      ...(Array.isArray(ruleResult.notes) ? (ruleResult.notes as string[]) : []),
      ...ragContext.notes,
    ],
  };
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: '仅支持 POST 请求' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  const authResult = await authenticateEdgeRequest(req, {
    allowPromptAdmin: true,
    allowSupabaseUser: true,
  });
  if (!authResult) {
    return new Response(JSON.stringify({ success: false, error: '未登录' }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: 'Supabase 环境变量缺失' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  try {
    const body = await req.json();
    const question = String(body?.question || '').trim();

    if (!question) {
      return new Response(JSON.stringify({ success: false, error: '缺少 question' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // 输入验证
    const promptValidation = validatePromptInput(question);
    if (!promptValidation.valid) {
      return new Response(JSON.stringify({ success: false, error: `输入无效: ${promptValidation.errors.join('，')}` }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // 限流
    const rateLimitKey = authResult.type === 'prompt_admin'
      ? `genbi:admin:${authResult.payload?.sub ?? 'unknown'}`
      : authResult.type === 'supabase_user'
        ? `genbi:user:${authResult.user?.id ?? authResult.user?.email ?? 'unknown'}`
        : 'genbi:anonymous';

    const rateLimitResult = checkRateLimit(rateLimitKey, {
      maxRequests: authResult.type === 'prompt_admin' ? 20 : 6,
      windowMs: 60000,
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult);
    }

    const response = await handleIntent(question);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return createErrorResponse(error, 'genbi-query');
  }
});
