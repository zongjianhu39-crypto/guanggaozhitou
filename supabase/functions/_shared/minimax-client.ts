/**
 * 共享 MiniMax AI 调用客户端
 * 供 ai-analysis 和 genbi-query 共同使用
 */

const denoEnv = globalThis.Deno?.env;
const MINIMAX_API_KEY = denoEnv?.get('MINIMAX_API_KEY') ?? '';
const MINIMAX_MODEL = 'MiniMax-M2.7';

export async function callMiniMax(
  prompt: string,
  systemPrompt?: string,
  options?: { maxTokens?: number }
): Promise<string> {
  if (!MINIMAX_API_KEY) {
    throw new Error('Missing MINIMAX_API_KEY');
  }

  // MiniMax-M2.7 是推理模型，会先输出 <think> 思考块，占用大量 token；
  // 默认 32768（模型上限）避免任何场景下的截断风险。
  const maxTokens = options?.maxTokens ?? 32768;

  const response = await fetch('https://api.minimax.chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      max_tokens: maxTokens,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[minimax-client] API 错误: ${response.status} - ${errText}`);
    throw new Error(`MiniMax API error: ${response.status}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content ?? '';
}
