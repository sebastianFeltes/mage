const TTL_MS = 5 * 60_000;
const MAX = 256;

type Entry = { at: number; status: number; body: string };

const cache = new Map<string, Entry>();

export const idempotencyKey = (
  header: string | null,
  query: string,
  sessionId: string | undefined,
  tenantId: string | undefined,
): string | null => {
  const raw = header?.trim();
  if (!raw) return null;
  if (raw.length > 256) return null;
  return `${raw}\n${query}\n${sessionId ?? ""}\n${tenantId ?? "default"}`;
};

export const getIdempotent = (key: string): { status: number; body: string } | null => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { status: hit.status, body: hit.body };
};

export const putIdempotent = (key: string, status: number, body: string): void => {
  if (cache.size >= MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), status, body });
};

export const resetIdempotency = (): void => {
  cache.clear();
};
