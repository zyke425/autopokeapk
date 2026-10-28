package io.github.zyke425.autopoke;

import java.net.URI;
import java.util.Locale;

/** Counts load failures only; never retains URLs, headers, page text or tokens. */
final class LoadDiagnostics {
    private int mainHttp, mainNetwork, scripts, styles, other, lastHttp, lastNetwork;
    synchronized void clear() { mainHttp = mainNetwork = scripts = styles = other = lastHttp = lastNetwork = 0; }
    synchronized void http(String url, boolean main, int status) {
        if (status < 400) return;
        lastHttp = status;
        if (main) mainHttp = status; else resource(url);
    }
    synchronized void network(String url, boolean main, int code) {
        lastNetwork = code;
        if (main) mainNetwork = code; else resource(url);
    }
    private void resource(String url) {
        String path = "";
        try { path = URI.create(url).getPath().toLowerCase(Locale.ROOT); } catch (Exception ignored) { }
        if (path.endsWith(".js")) scripts++; else if (path.endsWith(".css")) styles++; else other++;
    }
    synchronized String summary() {
        return "Main HTTP error: " + mainHttp + " (0 = none observed)\nMain network error: " + mainNetwork
            + "\nFailed scripts: " + scripts + "\nFailed styles: " + styles + "\nOther failed resources: " + other
            + "\nLast HTTP error: " + lastHttp + "\nLast network error: " + lastNetwork;
    }
}
