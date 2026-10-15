// src/services/PendingQueryStore.ts
//
// In-memory store for queries that were deferred because the user had
// not completed Infor sign-in. Keyed by conversationId + aadObjectId so
// that a stale entry cannot be replayed by a different user.
//
// Lives only for the lifetime of the Node process — a restart clears it,
// which is acceptable because the user will re-trigger the tile anyway.

import type { PendingQuery } from '../types';

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map<string, PendingQuery>();

function key(conversationId: string, aadObjectId: string): string {
  return `${conversationId}::${aadObjectId}`;
}

export function setPendingQuery(
  conversationId: string,
  aadObjectId: string,
  query: string,
): void {
  if (!conversationId || !aadObjectId || !query) return;
  store.set(key(conversationId, aadObjectId), {
    query,
    aadObjectId,
    createdAt: Date.now(),
  });
  console.log(
    `[PendingQueryStore] stored query for conv=${conversationId} oid=${aadObjectId}`,
  );
}

export function takePendingQuery(
  conversationId: string,
  aadObjectId: string,
): PendingQuery | undefined {
  const k = key(conversationId, aadObjectId);
  const entry = store.get(k);
  if (!entry) return undefined;
  store.delete(k);
  if (Date.now() - entry.createdAt > TTL_MS) {
    console.log('[PendingQueryStore] expired entry discarded');
    return undefined;
  }
  return entry;
}

export function hasPendingQuery(
  conversationId: string,
  aadObjectId: string,
): boolean {
  const k = key(conversationId, aadObjectId);
  const entry = store.get(k);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(k);
    return false;
  }
  return true;
}

export function clearPendingQuery(
  conversationId: string,
  aadObjectId: string,
): void {
  store.delete(key(conversationId, aadObjectId));
}