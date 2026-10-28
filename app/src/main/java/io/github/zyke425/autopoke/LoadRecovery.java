package io.github.zyke425.autopoke;

/** Bounded retries for failed page loads. Callers use a monotonic clock. */
final class LoadRecovery {
    private int failures;
    private long dueAt;

    boolean queue(long now) {
        if (failures >= 5) return false;
        long delay = Math.min(300_000L, 30_000L << failures);
        failures++;
        dueAt = now + delay;
        return true;
    }

    long remaining(long now) { return Math.max(0, dueAt - now); }
    void reset() { failures = 0; dueAt = 0; }
}
