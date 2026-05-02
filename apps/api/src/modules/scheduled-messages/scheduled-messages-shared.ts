// Shared constants + helpers used by both the group-scheduled-messages
// worker and the private-scheduled-messages worker. Kept identical so
// the two queues behave the same way under load — same backoff, same
// claim TTL, same per-tick batch + pacing — and so changing the
// behavior of one mechanically updates the other.

// Tick cadence: every minute. Per-tick batch size keeps the work
// bounded so a backlog doesn't starve the API. Pacing inside a tick
// (small inter-send delay) protects WhatsApp from a burst that could
// trip rate limits or look like spam.
export const TICK_BATCH_SIZE = 5;
export const SEND_PACING_MS = 1500;

// Retry schedule. attemptCount tracks how many sends we've already
// tried; the backoff-delay table picks the next nextRetryAt offset.
// After MAX_ATTEMPTS the row is moved to terminal 'failed'.
export const MAX_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

// Stale-claim TTL — if a worker dies mid-send, the row's claim is
// auto-released after this window so the next tick can retry.
export const CLAIM_TTL_MS = 5 * 60_000;

// Stable identifier for the calling worker process. Used both for
// log-grep ("which process sent this row?") and for the success-write
// WHERE clause that double-checks "the row I claimed is still mine"
// before flipping status='sent'.
export function makeWorkerId(): string {
  return `${process.pid}-${Date.now()}`;
}
