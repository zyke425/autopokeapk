package io.github.zyke425.autopoke;

/** Escalate a blank browser from reload to replacement, without a crash loop. */
final class BrowserRecovery {
    private int failures;
    private long dueAt;
    private long healthySince = -1;
    private boolean recreate;

    boolean queue(long now, boolean rendererLost) {
        healthySince = -1;
        if (failures >= 3) return false;
        long[] delays = {1_000, 3_000, 10_000};
        dueAt = now + delays[failures];
        failures++;
        recreate = rendererLost || failures > 1;
        return true;
    }

    boolean shouldRecreate() { return recreate; }
    long remaining(long now) { return Math.max(0, dueAt - now); }
    void healthy(long now) {
        if (healthySince < 0) healthySince = now;
        if (now - healthySince >= 60_000) reset();
    }
    void reset() { failures = 0; dueAt = 0; healthySince = -1; recreate = false; }
}
