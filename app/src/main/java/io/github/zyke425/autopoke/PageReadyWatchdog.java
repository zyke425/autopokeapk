package io.github.zyke425.autopoke;

/** One deadline for reaching Pokes, including all redirects and document loads. */
final class PageReadyWatchdog {
    private long dueAt = -1;
    void start(long now) { if (dueAt < 0) dueAt = now + 45_000; }
    long remaining(long now) { return dueAt < 0 ? 45_000 : Math.max(0, dueAt - now); }
    boolean waiting() { return dueAt >= 0; }
    void cancel() { dueAt = -1; }
}
