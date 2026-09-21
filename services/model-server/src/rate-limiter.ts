export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  consume(key: string, now = Date.now()): boolean {
    const active = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > now - this.windowMs);
    if (active.length >= this.limit) {
      this.attempts.set(key, active);
      return false;
    }
    active.push(now);
    this.attempts.set(key, active);
    return true;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
