// Minimal IndexedDB wrapper for the scanner: token cache + redemption outbox (FR-S4/S5).
// Runs client-side only.

type CachedToken = { token: string; status: string; redeemedAt?: string };
type OutboxItem = { token: string; station: string; scannedAt: string };

const DB = "ms-ticketing";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheTokens(tokens: CachedToken[], eventId: string) {
  await idb("readwrite", (s) => s.put({ tokens, eventId, syncedAt: new Date().toISOString() }, "tokenCache"));
}

export async function getCachedTokens(): Promise<{ tokens: CachedToken[]; syncedAt: string } | null> {
  return (await idb("readonly", (s) => s.get("tokenCache"))) ?? null;
}

export async function markLocalRedeemed(token: string) {
  const cache = await getCachedTokens();
  if (!cache) return;
  const t = cache.tokens.find((x) => x.token === token);
  if (t) t.status = "redeemed";
  await cacheTokens(cache.tokens, cache.eventId);
}

export async function enqueueRedemption(item: OutboxItem) {
  const existing: OutboxItem[] = (await idb("readonly", (s) => s.get("outbox"))) ?? [];
  await idb("readwrite", (s) => s.put([...existing, item], "outbox"));
}

export async function drainOutbox(): Promise<OutboxItem[]> {
  const items: OutboxItem[] = (await idb("readonly", (s) => s.get("outbox"))) ?? [];
  if (items.length) await idb("readwrite", (s) => s.put([], "outbox"));
  return items;
}

export async function outboxCount(): Promise<number> {
  const items: OutboxItem[] = (await idb("readonly", (s) => s.get("outbox"))) ?? [];
  return items.length;
}
