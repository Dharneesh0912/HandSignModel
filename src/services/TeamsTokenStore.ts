import { EventEmitter } from 'events';

interface TokenEntry { token: string; expires_at: number; }

const store = new Map<string, TokenEntry>();
export const tokenEvents = new EventEmitter();
const DEFAULT_TTL_MS = 55 * 60 * 1000;

export function putToken(aadObjectId: string, token: string): void {
  if (!aadObjectId || !token) return;
  store.set(aadObjectId, { token, expires_at: Date.now() + DEFAULT_TTL_MS });
  tokenEvents.emit('token:available', aadObjectId);
}

export async function consumeToken(aadObjectId: string): Promise<string | undefined> {
  const entry = store.get(aadObjectId);
  if (!entry) return undefined;
  if (entry.expires_at <= Date.now()) { store.delete(aadObjectId); return undefined; }
  store.delete(aadObjectId);
  return entry.token;
}

/* ─────────────────────────────────────────────────────────────────────
   Periodic eviction — prevents leaks when a token is put but never
   consumed (user signs in but never asks a question).
   .unref() so the timer does not keep the Node process alive.
   ──────────────────────────────────────────────────────────────────── */
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of store) {
    if (entry.expires_at <= now) {
      store.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[TeamsTokenStore] evicted ${removed} expired token(s)`);
  }
}, 60_000).unref();