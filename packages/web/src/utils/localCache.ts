interface CacheEntry<T> {
  data: T;
  ts: number;
  ttl?: number;
}

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Named TTL constants for each module
export const TTL = {
  NOTEBOOK: 7 * 24 * 60 * 60 * 1000,    // 7 days
  FILE_CONTENT: 3 * 24 * 60 * 60 * 1000, // 3 days
  BINARY_CONTENT: 24 * 60 * 60 * 1000,  // 24 hours (PDF/DOCX/XLSX/PPTX)
  SCROLL: 7 * 24 * 60 * 60 * 1000,       // 7 days
  TITLE: 7 * 24 * 60 * 60 * 1000,        // 7 days
  LAST_NOTEBOOK: 30 * 24 * 60 * 60 * 1000, // 30 days
  GIT_HISTORY: 1 * 24 * 60 * 60 * 1000,  // 1 day
  DRAFT: 7 * 24 * 60 * 60 * 1000,        // 7 days
  ANNOTATION: 7 * 24 * 60 * 60 * 1000,   // 7 days
  FILE_LIST: 5 * 60 * 1000,              // 5 minutes
} as const;

export function cacheSet<T>(key: string, data: T, ttl?: number): void {
  const entry: CacheEntry<T> = { data, ts: Date.now(), ttl };
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota exceeded — evict expired entries and retry
    evictExpired();
    try {
      localStorage.setItem(key, JSON.stringify(entry));
    } catch { /* still full — give up silently */ }
  }
}

export function cacheGet<T>(key: string, ttl = DEFAULT_TTL): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > ttl) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheRemove(key: string): void {
  localStorage.removeItem(key);
}

function evictExpired(): void {
  const now = Date.now();
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const entry = JSON.parse(raw) as { ts?: number; ttl?: number };
      if (typeof entry.ts === 'number' && now - entry.ts > (entry.ttl ?? DEFAULT_TTL)) {
        localStorage.removeItem(key);
      }
    } catch { /* skip non-JSON entries */ }
  }
}
