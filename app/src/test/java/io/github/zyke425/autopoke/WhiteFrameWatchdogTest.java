package io.github.zyke425.autopoke;

import java.util.Arrays;
import org.junit.Test;
import static org.junit.Assert.*;

public final class WhiteFrameWatchdogTest {
    private int[] white() { int[] pixels = new int[4096]; Arrays.fill(pixels, 0xffffffff); return pixels; }

    @Test public void sustainedWhiteOutputTriggersAfterTenSeconds() {
        WhiteFrameWatchdog watchdog = new WhiteFrameWatchdog();
        assertFalse(watchdog.observe(100, white()));
        assertFalse(watchdog.observe(10_099, white()));
        assertTrue(watchdog.observe(10_100, white()));
    }
    @Test public void contentOrPauseClearsTheWhiteDeadline() {
        WhiteFrameWatchdog watchdog = new WhiteFrameWatchdog();
        watchdog.observe(100, white());
        int[] content = white(); Arrays.fill(content, 0, 30, 0xff202020);
        assertFalse(watchdog.observe(20_000, content));
        assertFalse(watchdog.observe(30_000, white()));
        watchdog.reset(); assertFalse(watchdog.observe(60_000, white()));
    }
    @Test public void mostlyWhiteContentAndDarkPagesAreNotBlankWhiteOutput() {
        int[] content = white(); Arrays.fill(content, 0, 20, 0xff707070);
        assertFalse(WhiteFrameWatchdog.isWhite(content));
        Arrays.fill(content, 0xff242526); assertFalse(WhiteFrameWatchdog.isWhite(content));
        Arrays.fill(content, 0x00ffffff); assertFalse(WhiteFrameWatchdog.isWhite(content));
        assertFalse(WhiteFrameWatchdog.isWhite(new int[0]));
    }
}
