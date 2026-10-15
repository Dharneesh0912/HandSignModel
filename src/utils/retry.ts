export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastError = err;
      if (!opts.shouldRetry(err) || attempt === opts.maxAttempts) throw err;
      const delay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export function isTransientHttpError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (/HTTP 5\d\d/.test(msg)) return true;
  if (/HTTP 429/.test(msg)) return true;
  if (/HTTP 400|HTTP 401|HTTP 403|HTTP 404/.test(msg)) return false;
  if (/Network error|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/.test(msg)) return true;
  return false;
}