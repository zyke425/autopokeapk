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
    @Test public void regularMobileFallbackKeepsItsLayoutAcrossRecovery() {
        MobileRecovery recovery = new MobileRecovery();
        assertEquals("https://m.facebook.com/pokes", recovery.address(false));
        for (int i = 0; i < 3; i++) {
            recovery.blank();
            assertEquals("https://www.facebook.com/pokes?ref=search", recovery.address(false));
        }
        recovery.reset();
        assertEquals("https://m.facebook.com/pokes", recovery.address(false));
        assertEquals("https://www.facebook.com/pokes?ref=search", recovery.address(true));
    }
    @Test public void mobileCompatibilityKeepsAndroidMobileAndTheInstalledEngineVersion() {
        String installed = "Mozilla/5.0 (Linux; Android 14; Phone; wv) AppleWebKit/537.36 Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36";
        MobileRecovery recovery = new MobileRecovery();
        assertEquals(installed, recovery.userAgent(installed, false));
        recovery.blank(); String compatible = recovery.userAgent(installed, false);
        assertTrue(compatible.contains("Android 14")); assertTrue(compatible.contains("Mobile"));
        assertTrue(compatible.contains("Chrome/131.0.6778.200"));
        assertFalse(compatible.contains("; wv")); assertFalse(compatible.contains("Version/4.0"));
        recovery.reset(); assertEquals(installed, recovery.userAgent(installed, false));
    }
    @Test public void desktopAgentDoesNotLeakIntoTheBasicMobileRetry() {
        String installed = "Mozilla/5.0 (Linux; Android 14; wv) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36";
        MobileRecovery recovery = new MobileRecovery(); recovery.blank();
        assertTrue(recovery.userAgent(installed, true).contains("X11; Linux x86_64"));
        assertFalse(recovery.userAgent(installed, true).contains("Mobile"));
        assertTrue(recovery.userAgent(installed, false).contains("Android 14"));
        assertTrue(recovery.userAgent(installed, false).contains("Mobile"));
    }
}
