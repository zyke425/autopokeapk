package io.github.zyke425.autopoke;

import org.junit.Test;
import static org.junit.Assert.*;

public final class MobileRecoveryTest {
    @Test public void repeatBlanksEscalateFromHostRetryToSoftwareRendering() {
        MobileRecovery recovery = new MobileRecovery();
        assertFalse(recovery.useMainHost()); assertFalse(recovery.useSoftware());
        assertFalse(recovery.blank());
        assertTrue(recovery.useMainHost()); assertFalse(recovery.useSoftware());
        assertTrue(recovery.blank()); assertTrue(recovery.useSoftware());
        assertTrue(recovery.blank()); assertTrue(recovery.useSoftware());
    }
    @Test public void changingLayoutRestoresTheNormalRenderingPath() {
        MobileRecovery recovery = new MobileRecovery();
        recovery.blank(); recovery.blank(); recovery.reset();
        assertFalse(recovery.useMainHost()); assertFalse(recovery.useSoftware());
        assertFalse(recovery.blank());
    }
    @Test public void carrierFreeModeNeverFallsBackToTheStandardAddress() {
        MobileRecovery recovery = new MobileRecovery();
        assertEquals("https://m.facebook.com/pokes", recovery.address(false, false));
        for (int i = 0; i < 3; i++) {
            recovery.blank();
            assertEquals("https://free.facebook.com/pokes", recovery.address(false, true));
            assertEquals("https://www.facebook.com/pokes?ref=search", recovery.address(false, false));
        }
        recovery.reset();
        assertEquals("https://m.facebook.com/pokes", recovery.address(false, false));
        assertEquals("https://www.facebook.com/pokes?ref=search", recovery.address(true, false));
    }
}
