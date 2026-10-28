package io.github.zyke425.autopoke;

/** Keep the mobile layout while escalating a page that fails to render. */
final class MobileRecovery {
    private int blanks;

    // The first retry uses the main host with the mobile user agent. A second
    // blank enables software drawing on the replacement WebView for this session.
    boolean blank() { blanks = Math.min(2, blanks + 1); return useSoftware(); }
    boolean useMainHost() { return blanks > 0; }
    boolean useSoftware() { return blanks >= 2; }
    String address(boolean desktop, boolean freeMode) {
        if (freeMode) return "https://free.facebook.com/pokes";
        return desktop || useMainHost() ? "https://www.facebook.com/pokes?ref=search" : "https://m.facebook.com/pokes";
    }
    void reset() { blanks = 0; }
}
