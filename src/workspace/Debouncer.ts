/**
 * Turns a burst of events into one call. An agent that edits ten files in two seconds should
 * cause one refresh, not ten: `run` fires once `delayMs` have passed without a new trigger.
 * `maxWaitMs` caps the wait, so a long uninterrupted burst still refreshes now and then and the
 * reviewer sees progress while the agent is still working.
 */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstTrigger = 0;

  constructor(
    private readonly run: () => void,
    private readonly delayMs: number,
    private readonly maxWaitMs: number,
  ) {}

  trigger(): void {
    const now = Date.now();
    if (this.timer === undefined) {
      this.firstTrigger = now;
    } else {
      clearTimeout(this.timer);
    }
    // Wait for quiet, but never longer than maxWait since the first trigger of this burst.
    const wait = Math.max(0, Math.min(this.delayMs, this.firstTrigger + this.maxWaitMs - now));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.run();
    }, wait);
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
