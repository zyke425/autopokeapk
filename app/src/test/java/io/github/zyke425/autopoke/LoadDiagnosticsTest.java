package io.github.zyke425.autopoke;

import org.junit.Test;
import static org.junit.Assert.*;

public final class LoadDiagnosticsTest {
    @Test public void distinguishesMissingBootstrapResourcesFromOtherFailures() {
        LoadDiagnostics d = new LoadDiagnostics();
        d.http("https://static.xx.fbcdn.net/rsrc.php/file.js?token=secret", false, 403);
        d.network("https://static.xx.fbcdn.net/file.css?token=secret", false, -2);
        d.http("https://example.org/avatar.jpg", false, 403);
        assertTrue(d.summary().contains("Failed scripts: 1")); assertTrue(d.summary().contains("Failed styles: 1"));
        assertTrue(d.summary().contains("Other failed resources: 1"));
        assertFalse(d.summary().contains("secret")); assertFalse(d.summary().contains("https://"));
    }
    @Test public void mainDocumentErrorsDoNotMasqueradeAsScriptFailures() {
        LoadDiagnostics d = new LoadDiagnostics();
        d.http("https://m.facebook.com/pokes?private=secret", true, 403);
        d.network("https://m.facebook.com/pokes", true, -6);
        assertTrue(d.summary().contains("Main HTTP error: 403"));
        assertTrue(d.summary().contains("Main network error: -6"));
        assertTrue(d.summary().contains("Failed scripts: 0"));
    }
    @Test public void freshUserAttemptClearsOldEvidenceAndSuccessIsNotAnError() {
        LoadDiagnostics d = new LoadDiagnostics(); d.http("https://x/file.js", false, 403); d.clear();
        d.http("https://x/file.js", false, 200);
        assertTrue(d.summary().contains("Failed scripts: 0")); assertTrue(d.summary().contains("Last HTTP error: 0"));
    }
}
