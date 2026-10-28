package io.github.zyke425.autopoke;

import org.junit.Test;
import static org.junit.Assert.*;

public final class BasicNavigationTest {
    @Test public void mobileHostSurvivesSetupPokesAndBlankPageRecovery() {
        assertEquals("https://m.facebook.com/", BasicNavigation.home("https://m.facebook.com/?zero=1", ""));
        assertEquals("https://m.facebook.com/pokes", BasicNavigation.pokes("https://m.facebook.com/", "", "https://www.facebook.com"));
        assertEquals("https://m.facebook.com/pokes.php?ref=menu", BasicNavigation.pokes("https://m.facebook.com/pokes.php?ref=menu", "", ""));
    }
    @Test public void aSiteProvidedNavigationLinkKeepsCarrierAndReferralParameters() {
        String link = "https://m.facebook.com/pokes/?ref=menu&zero=carrier#top";
        assertEquals("https://m.facebook.com/pokes/?ref=menu&zero=carrier", BasicNavigation.pokes("https://www.facebook.com/", link, ""));
    }
    @Test public void refreshStaysOnTheCurrentPokesRouteInsteadOfHomeOrAnOldLink() {
        String current = "https://m.facebook.com/pokes/?zero=current&ref=basic#top";
        assertEquals("https://m.facebook.com/pokes/?zero=current&ref=basic",
            BasicNavigation.pokes(current, "https://www.facebook.com/pokes?ref=old", "https://www.facebook.com"));
    }
    @Test public void aHomeOrClientOnlyRouteRefreshesTheLearnedPokesLink() {
        String learned = "https://m.facebook.com/pokes?ref=menu&zero=carrier";
        for (String current : new String[]{"https://m.facebook.com/", "https://m.facebook.com/?sk=h_chr", "https://m.facebook.com/menu"})
            assertEquals(learned, BasicNavigation.pokes(current, learned, ""));
    }
    @Test public void anActionRouteCannotOverrideTheLearnedSafePokesRefresh() {
        String learned = "https://m.facebook.com/pokes?zero=carrier";
        assertEquals(learned, BasicNavigation.pokes("https://m.facebook.com/pokes?poke_target=123", learned, ""));
        assertEquals(learned, BasicNavigation.pokes("https://m.facebook.com/a/pokes.php?uid=123", learned, ""));
    }
    @Test public void rememberedOriginIsUsedAfterRendererLossAndMobileIsTheDefault() {
        assertEquals("https://m.facebook.com/pokes", BasicNavigation.pokes(null, "", "https://m.facebook.com"));
        assertEquals("https://m.facebook.com/pokes", BasicNavigation.pokes(null, "", ""));
        assertEquals("https://free.facebook.com/", BasicNavigation.home(null, "https://free.facebook.com"));
    }
    @Test public void actionUrlsAreNeverReplayedAsPokesNavigation() {
        for (String query : new String[]{"poke_target=1", "ref=x&action=send", "%70oke_target=1", "fb_dtsg=secret", "action", "ref=x%0A&uid=1"}) {
            assertFalse(BasicNavigation.pokesLink("https://m.facebook.com/pokes?" + query));
            assertEquals("https://m.facebook.com/pokes", BasicNavigation.pokes("https://m.facebook.com/pokes?" + query, "", ""));
        }
        assertFalse(BasicNavigation.pokesLink("https://m.facebook.com/a/pokes.php"));
    }
    @Test public void invalidOriginsCannotReplaceTheFacebookSession() {
        for (String url : new String[]{"http://m.facebook.com/pokes", "https://facebook.com.example.org/pokes", "https://m.facebook.com@evil.example/pokes", "https://user@m.facebook.com/pokes", "https://m.facebook.com:444/pokes", "javascript:alert(1)", "https://business.facebook.com/pokes"}) {
            assertFalse(BasicNavigation.pokesLink(url));
            assertEquals("https://m.facebook.com/pokes", BasicNavigation.pokes(url, url, ""));
        }
    }
}
