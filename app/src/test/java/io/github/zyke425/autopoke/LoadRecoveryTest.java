package io.github.zyke425.autopoke;

import org.junit.Test;
import static org.junit.Assert.*;

public final class LoadRecoveryTest {
    @Test public void repeatedFailuresBackOffAndEventuallyRequireManualAction() {
        LoadRecovery policy = new LoadRecovery();
        long now = 1_000;
        long[] delays = {30_000, 60_000, 120_000, 240_000, 300_000};
        for (long delay : delays) {
            assertTrue(policy.queue(now));
            assertEquals(delay, policy.remaining(now));
            assertEquals(1, policy.remaining(now + delay - 1));
            assertEquals(0, policy.remaining(now + delay));
            now += delay + 45_000;
        }
        assertFalse(policy.queue(now));
    }
    @Test public void healthyPageOrExplicitRestartRestoresTheRetryBudget() {
        LoadRecovery policy = new LoadRecovery();
        for (int i = 0; i < 5; i++) assertTrue(policy.queue(1_000));
        assertFalse(policy.queue(1_000));
        policy.reset();
        assertTrue(policy.queue(100_000));
        assertEquals(30_000, policy.remaining(100_000));
    }
    @Test public void elapsedDeadlineDoesNotReturnNegativeDelay() {
        LoadRecovery policy = new LoadRecovery();
        assertTrue(policy.queue(100));
        assertEquals(0, policy.remaining(1_000_000));
    }
}
