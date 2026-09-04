// Fixed-window in-memory rate limiter for the invite endpoint (§10).
// Single-process state is sufficient: the deployment target is one
// container (§2).
export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly hits = new Map<
    string,
    { windowStart: number; count: number }
  >();

  constructor(options: { max: number; windowMs: number }) {
    this.max = options.max;
    this.windowMs = options.windowMs;
  }

  allow(key: string, now: number = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }
}
