import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountInput } from "../src/shared/types";
import { StoreDatabase } from "../src/server/database";
import { ArchiveService } from "../src/server/services/archive";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("lokales Mailarchiv", () => {
  it("legt RFC-822-Originale ab, indexiert Inhalt und bewahrt sie nach dem Trennen", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-archive-"));
    temporaryDirectories.push(directory);
    const database = new StoreDatabase(path.join(directory, "archivhafen.sqlite"));
    const archive = new ArchiveService(directory, database);
    const account = database.createAccount(accountInput(), "encrypted-placeholder");
    const folder = database.upsertFolder({
      accountId: account.id,
      path: "INBOX",
      name: "Posteingang",
      specialUse: "\\Inbox",
    });

    const first = await archive.archive({
      accountId: account.id,
      folderId: folder.id,
      uidValidity: "42",
      imapUid: 7,
      source: fixtureMail(),
      flags: ["\\Seen"],
      internalDate: "2026-07-19T09:10:00.000Z",
    });

    expect(first.inserted).toBe(true);
    const search = database.listMessages({ query: "Projektstatus Berlin" });
    expect(search.total).toBe(1);
    expect(search.items[0].subject).toBe("Projektstatus für Montag");
    expect(search.items[0].hasAttachments).toBe(true);

    const detail = await archive.parseDetail(first.id);
    expect(detail?.text).toContain("Meilenstein");
    expect(detail?.attachments[0].filename).toBe("notiz.txt");

    const raw = await archive.rawPath(first.id);
    expect(raw && fs.existsSync(raw.absolutePath)).toBe(true);
    expect(raw && fs.readFileSync(raw.absolutePath).equals(fixtureMail())).toBe(true);

    expect(database.disconnectAccount(account.id)).toBe(true);
    expect(database.getAccount(account.id)?.connected).toBe(false);
    expect(database.listMessages({}).total).toBe(1);
    expect(raw && fs.existsSync(raw.absolutePath)).toBe(true);

    const reconnected = database.reconnectAccount(account.id, {
      ...accountInput(),
      name: "Privat – neu verbunden",
    }, "new-encrypted-placeholder");
    expect(reconnected?.connected).toBe(true);
    expect(reconnected?.messageCount).toBe(1);
    expect(database.listAccounts()).toHaveLength(1);
    database.close();
  });

  it("archiviert identische Nachrichten je Postfach nur einmal", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-dedupe-"));
    temporaryDirectories.push(directory);
    const database = new StoreDatabase(path.join(directory, "archivhafen.sqlite"));
    const archive = new ArchiveService(directory, database);
    const account = database.createAccount(accountInput(), "encrypted-placeholder");
    const inbox = database.upsertFolder({ accountId: account.id, path: "INBOX", name: "Posteingang", specialUse: "\\Inbox" });
    const all = database.upsertFolder({ accountId: account.id, path: "Alle", name: "Alle Nachrichten", specialUse: "\\All" });

    const first = await archive.archive({ accountId: account.id, folderId: inbox.id, uidValidity: "1", imapUid: 1, source: fixtureMail() });
    const duplicate = await archive.archive({ accountId: account.id, folderId: all.id, uidValidity: "1", imapUid: 99, source: fixtureMail() });

    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(database.listMessages({}).total).toBe(1);
    database.close();
  });
});

function accountInput(): AccountInput {
  return {
    name: "Privat",
    email: "marie@example.test",
    provider: "custom",
    imapHost: "imap.example.test",
    imapPort: 993,
    imapSecure: true,
    username: "marie@example.test",
    password: "not-stored-here",
  };
}

function fixtureMail(): Buffer {
  return Buffer.from([
    "From: Marie Beispiel <marie@example.test>",
    "To: Team <team@example.test>",
    "Date: Sun, 19 Jul 2026 11:10:00 +0200",
    "Message-ID: <projekt-42@example.test>",
    "Subject: Projektstatus für Montag",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=archivhafen-test",
    "",
    "--archivhafen-test",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "Hallo Team, der nächste Meilenstein in Berlin ist erreicht.",
    "",
    "--archivhafen-test",
    "Content-Type: text/plain; name=notiz.txt",
    "Content-Disposition: attachment; filename=notiz.txt",
    "Content-Transfer-Encoding: base64",
    "",
    "VGVzdGFuaGFuZw==",
    "--archivhafen-test--",
    "",
  ].join("\r\n"), "utf8");
}
