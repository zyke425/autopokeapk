package io.github.zyke425.autopoke;

/** Keep the mobile layout while escalating a page that fails to render. */
final class MobileRecovery {
    private int blanks;

    // The first retry uses the main host with a mobile-browser agent. A second
    // blank enables software drawing on the replacement WebView for this session.
    boolean blank() { blanks = Math.min(2, blanks + 1); return useSoftware(); }
    boolean useMainHost() { return blanks > 0; }
    boolean useSoftware() { return blanks >= 2; }
    String userAgent(String installedAgent, boolean desktop) {
        if (!desktop && blanks == 0) return installedAgent;
        // Compatibility retry requests the mobile browser presentation, keeping
        // the installed engine's version. No Facebook Lite identity is invented.
        String browserAgent = installedAgent.replace("; wv", "").replace("Version/4.0 ", "");
        return desktop ? browserAgent.replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)").replace(" Mobile", "") : browserAgent;
    }
    String address(boolean desktop, boolean basicMode) {
        // Current carrier Basic mode is offered on the normal mobile website.
        // Keep setup and Pokes on the same host/session instead of the old free host.
        if (basicMode) return "https://www.facebook.com/pokes?ref=search";
        return desktop || useMainHost() ? "https://www.facebook.com/pokes?ref=search" : "https://m.facebook.com/pokes";
    }
    void reset() { blanks = 0; }
}
