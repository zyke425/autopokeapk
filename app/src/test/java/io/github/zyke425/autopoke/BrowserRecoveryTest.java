package io.github.zyke425.autopoke;

import org.junit.Test;
import static org.junit.Assert.*;

public final class BrowserRecoveryTest {
    @Test public void firstBlankReloadsThenRepeatedBlanksReplaceTheBrowser() {
        BrowserRecovery policy = new BrowserRecovery();
        assertTrue(policy.queue(100, false));
        assertFalse(policy.shouldRecreate());
        assertEquals(1_000, policy.remaining(100));
        assertTrue(policy.queue(12_000, false));
        assertTrue(policy.shouldRecreate());
        assertEquals(3_000, policy.remaining(12_000));
        assertTrue(policy.queue(25_000, false));
        assertTrue(policy.shouldRecreate());
        assertEquals(10_000, policy.remaining(25_000));
        assertFalse(policy.queue(50_000, false));
    }
    @Test public void aDeadRendererIsReplacedOnItsFirstFailure() {
        BrowserRecovery policy = new BrowserRecovery();
        assertTrue(policy.queue(1_000, true));
        assertTrue(policy.shouldRecreate());
    }
    @Test public void oneHealthyFrameDoesNotResetTheCrashBudget() {
        BrowserRecovery policy = new BrowserRecovery();
        assertTrue(policy.queue(1_000, false));
        policy.healthy(5_000);
        assertTrue(policy.queue(6_000, false));
        assertTrue(policy.shouldRecreate());
    }
    @Test public void stableHealthyOperationRestoresTheRecoveryBudget() {
        BrowserRecovery policy = new BrowserRecovery();
        for (int i = 0; i < 3; i++) assertTrue(policy.queue(i * 10_000L, true));
        assertFalse(policy.queue(40_000, true));
        policy.healthy(50_000); policy.healthy(110_000);
        assertTrue(policy.queue(115_000, false));
        assertFalse(policy.shouldRecreate());
    }
    @Test public void userRestartAndElapsedDeadlineAreHandled() {
        BrowserRecovery policy = new BrowserRecovery();
        assertTrue(policy.queue(100, false));
        assertEquals(0, policy.remaining(5_000));
        policy.reset();
        assertTrue(policy.queue(6_000, false));
        assertFalse(policy.shouldRecreate());
    }
}
