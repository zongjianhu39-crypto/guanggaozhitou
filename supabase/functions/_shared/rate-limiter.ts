/**
 * API 限流工具
 * 使用固定窗口算法，内存计数
 * 适用于 Edge Function 单实例场景
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// 内存存储，Edge Function 重启后自动重置
const rateLimitStore = new Map<string, RateLimitRecord>();

// 清理过期记录的定时器
let cleanupTimer: number | null = null;

function scheduleCleanup() {
  if (cleanupTimer !== null) return;
  cleanupTimer = setTimeout(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetAt) {
        rateLimitStore.delete(key);
      }
    }
    cleanupTimer = null;
  }, 60000); // 每分钟清理一次
}

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  maxRequests: number;
  retryAfter?: number;
  resetAt?: number;
}

export interface RateLimitOptions {
  /** 时间窗口内最大请求数 */
  maxRequests: number;
  /** 时间窗口（毫秒），默认 60000（1 分钟） */
  windowMs?: number;
}

/**
 * 检查限流
 * @param key 限流标识（用户 ID、IP 等）
 * @param options 限流配置
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const windowMs = options.windowMs ?? 60000;
  const now = Date.now();

  scheduleCleanup();

  const record = rateLimitStore.get(key);

  if (!record || now > record.resetAt) {
    // 新时间窗口
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      currentCount: 1,
      maxRequests: options.maxRequests,
      resetAt: now + windowMs,
    };
  }

  if (record.count >= options.maxRequests) {
    // 超限
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return {
      allowed: false,
      currentCount: record.count,
      maxRequests: options.maxRequests,
      retryAfter,
      resetAt: record.resetAt,
    };
  }

  // 未超限，计数 +1
  record.count++;
  return {
    allowed: true,
    currentCount: record.count,
    maxRequests: options.maxRequests,
    resetAt: record.resetAt,
  };
}

/**
 * 创建限流响应
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
  return new Response(JSON.stringify({
    success: false,
    error: `请求过于频繁，请 ${result.retryAfter} 秒后重试`,
    retry_after: result.retryAfter,
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(result.retryAfter ?? 60),
      'X-RateLimit-Limit': String(result.maxRequests),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil((result.resetAt ?? Date.now()) / 1000)),
    },
  });
}

/**
 * 获取当前限流状态（不增加计数）
 */
export function getRateLimitStatus(key: string): RateLimitResult | null {
  const record = rateLimitStore.get(key);
  if (!record) return null;

  const now = Date.now();
  if (now > record.resetAt) {
    rateLimitStore.delete(key);
    return null;
  }

  return {
    allowed: record.count < 60, // 假设默认 60 次/分钟
    currentCount: record.count,
    maxRequests: 60,
    resetAt: record.resetAt,
  };
}
