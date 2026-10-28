package io.github.zyke425.autopoke;

import org.junit.Test;
import static org.junit.Assert.*;

public final class PageReadyWatchdogTest {
    @Test public void redirectsCannotExtendTheOriginalDeadline() {
        PageReadyWatchdog wait = new PageReadyWatchdog();
        wait.start(1_000);
        for (int i = 1; i <= 8; i++) wait.start(1_000 + i * 5_000L);
        assertEquals(1, wait.remaining(45_999));
        assertEquals(0, wait.remaining(46_000));
    }
    @Test public void aFinishedButUnusableDocumentStillHasADeadline() {
        PageReadyWatchdog wait = new PageReadyWatchdog();
        wait.start(100);
        // A document completion is intentionally not a readiness acknowledgement.
        wait.start(5_000);
        assertTrue(wait.waiting()); assertEquals(0, wait.remaining(60_000));
    }
    @Test public void readyViewOrManualSignInCancelsTheWait() {
        PageReadyWatchdog wait = new PageReadyWatchdog(); wait.start(100); wait.cancel();
        assertFalse(wait.waiting());
        wait.start(200_000); assertEquals(45_000, wait.remaining(200_000));
    }
    @Test public void aRepairStartsAFreshAttemptRatherThanAnImmediateTimeout() {
        PageReadyWatchdog wait = new PageReadyWatchdog(); wait.start(100);
        assertEquals(0, wait.remaining(50_000));
        wait.cancel(); wait.start(60_000);
        assertEquals(44_000, wait.remaining(61_000));
    }
    @Test public void aHiddenAppCanEndItsWaitAndRestartOnResume() {
        PageReadyWatchdog wait = new PageReadyWatchdog(); wait.start(100); wait.cancel();
        assertFalse(wait.waiting());
        wait.start(1_000_000); assertEquals(45_000, wait.remaining(1_000_000));
    }
}
