// Fixed-window in-memory rate limiter for the invite endpoint (§10).
// Single-process state is sufficient: the deployment target is one
// container (§2).
//
// The key (e.g. x-forwarded-for) is client-influenced, so the limiter
// bounds its own memory: expired entries are evicted as new keys arrive,
// and once maxKeys live entries exist, allow() denies unknown keys
// (fail-closed); blocked() and retryAfterMs() only read, so a caller
// that gates on them must pair a per-client limiter with a global cap,
// which is what bounds spoofed keys.
export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly hits = new Map<
    string,
    { windowStart: number; count: number }
  >();

  constructor(options: { max: number; windowMs: number; maxKeys?: number }) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  get size(): number {
    return this.hits.size;
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }

  // True when the key is over its limit right now; counts nothing.
  blocked(key: string, now: number = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) return false;
    return entry.count >= this.max;
  }

  // How long a blocked key waits until its window opens; 0 when not blocked.
  retryAfterMs(key: string, now: number = Date.now()): number {
    if (!this.blocked(key, now)) return 0;
    const entry = this.hits.get(key)!;
    return entry.windowStart + this.windowMs - now;
  }

  allow(key: string, now: number = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (entry && now - entry.windowStart < this.windowMs) {
      entry.count += 1;
      return entry.count <= this.max;
    }
    this.evictExpired(now);
    if (!entry && this.hits.size >= this.maxKeys) return false;
    this.hits.set(key, { windowStart: now, count: 1 });
    return true;
  }
}
