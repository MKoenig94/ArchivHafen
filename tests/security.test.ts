import { describe, expect, it } from "vitest";
import { cleanEmailHtml } from "../src/server/app";
import { friendlyImapError } from "../src/server/services/imap";

describe("sichere Maildarstellung", () => {
  it("entfernt aktive Inhalte und externe Bilder", () => {
    const cleaned = cleanEmailHtml(`
      <p onclick="alert(1)">Hallo</p>
      <img src="https://tracker.example/pixel.gif">
      <script>window.location = 'https://evil.example'</script>
      <a href="https://example.test">sicherer Link</a>
    `);

    expect(cleaned).toContain("<p>Hallo</p>");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).not.toContain("<img");
    expect(cleaned).not.toContain("<script");
    expect(cleaned).toContain('rel="noreferrer noopener"');
  });
});

describe("IMAP-Fehlermeldungen", () => {
  it("übersetzt technische Anmelde- und Netzwerkfehler", () => {
    expect(friendlyImapError(new Error("Authentication failed"))).toContain("Anmeldung fehlgeschlagen");
    expect(friendlyImapError(new Error("getaddrinfo ENOTFOUND imap.invalid"))).toContain("nicht gefunden");
    expect(friendlyImapError(new Error("Connection timeout"))).toContain("antwortet nicht");
  });
});
