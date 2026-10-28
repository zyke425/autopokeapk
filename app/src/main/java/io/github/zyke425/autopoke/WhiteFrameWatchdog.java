package io.github.zyke425.autopoke;

/** Distinguish sustained white output from a brief redraw or a mostly white page. */
final class WhiteFrameWatchdog {
    private long since = -1;

    boolean observe(long now, int[] pixels) {
        if (!isWhite(pixels)) { reset(); return false; }
        if (since < 0) since = now;
        return now - since >= 10_000;
    }
    void reset() { since = -1; }

    static boolean isWhite(int[] pixels) {
        if (pixels == null || pixels.length == 0) return false;
        int nonWhite = 0;
        for (int pixel : pixels) {
            if (((pixel >>> 24) & 255) < 250 || ((pixel >>> 16) & 255) < 245
                || ((pixel >>> 8) & 255) < 245 || (pixel & 255) < 245) nonWhite++;
        }
        return nonWhite <= pixels.length / 1000;
    }
}
