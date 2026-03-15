/**
 * 通用重试工具函数
 */

export interface RetryOptions {
  /** 最大重试次数（不含首次） */
  maxRetries?: number;
  /** 初始延迟 ms */
  delay?: number;
  /** 每次重试时的回调 */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * 包装一个异步函数，失败后自动重试（指数退避）
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 2, delay = 1000, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, lastError);
        await sleep(delay * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
