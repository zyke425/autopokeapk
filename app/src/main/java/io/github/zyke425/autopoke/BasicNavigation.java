package io.github.zyke425.autopoke;

import java.net.URI;
import java.util.Locale;

/** Preserve the Facebook host/link supplied during setup without replaying actions. */
final class BasicNavigation {
    static String origin(String value) {
        try {
            URI u = URI.create(value); String host = u.getHost();
            if (!"https".equalsIgnoreCase(u.getScheme()) || host == null || u.getUserInfo() != null
                || (u.getPort() != -1 && u.getPort() != 443)) return "";
            host = host.toLowerCase(Locale.ROOT);
            if (!host.matches("(?:www\\.|m\\.|mbasic\\.|free\\.)?facebook\\.com")) return "";
            return "https://" + host;
        } catch (Exception ignored) { return ""; }
    }
    static boolean pokesLink(String value) {
        if (origin(value).isEmpty()) return false;
        URI u = URI.create(value);
        if (!u.getPath().matches("/pokes(?:\\.php)?/?")) return false;
        String query = u.getRawQuery();
        if (query == null) return true;
        // Canonical navigation links may include carrier/referral parameters.
        // Reject known action parameters, including percent-encoded spellings.
        try { query = java.net.URLDecoder.decode(query, "UTF-8").toLowerCase(Locale.ROOT); }
        catch (Exception ignored) { return false; }
        for (String part : query.split("&")) {
            String key = part.split("=", 2)[0].trim();
            if (key.matches("poke_target|poke|target_id|uid|action|send_poke|fb_dtsg|jazoest")) return false;
        }
        return true;
    }
    static String home(String current, String rememberedOrigin) { return chooseOrigin(current, rememberedOrigin) + "/"; }
    static String pokes(String current, String discoveredLink, String rememberedOrigin) {
        if (pokesLink(discoveredLink)) {
            URI u = URI.create(discoveredLink);
            return origin(discoveredLink) + u.getRawPath() + (u.getRawQuery() == null ? "" : "?" + u.getRawQuery());
        }
        String path = "/pokes";
        try {
            if (!origin(current).isEmpty() && URI.create(current).getPath().matches("/pokes(?:\\.php)?/?")) path = URI.create(current).getRawPath();
        } catch (Exception ignored) { }
        return chooseOrigin(current, rememberedOrigin) + path;
    }
    private static String chooseOrigin(String current, String rememberedOrigin) {
        String actual = origin(current);
        if (!actual.isEmpty()) return actual;
        actual = origin(rememberedOrigin);
        return actual.isEmpty() ? "https://m.facebook.com" : actual;
    }
}
