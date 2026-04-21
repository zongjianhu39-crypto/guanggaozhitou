/**
 * 共享 MiniMax AI 调用客户端
 * 供 ai-analysis 和 genbi-query 共同使用
 */

const MINIMAX_API_KEY = Deno.env.get('MINIMAX_API_KEY') ?? '';
const MINIMAX_MODEL = 'MiniMax-M2.7';

export async function callMiniMax(
  prompt: string,
  systemPrompt?: string,
  options?: { maxTokens?: number }
): Promise<string> {
  if (!MINIMAX_API_KEY) {
    throw new Error('Missing MINIMAX_API_KEY');
  }

  const maxTokens = options?.maxTokens ?? 4096;

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
