import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImapFlow, ListResponse } from "imapflow";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountInput } from "../src/shared/types";
import { CredentialVault } from "../src/server/crypto";
import { StoreDatabase } from "../src/server/database";
import { CleanupManager } from "../src/server/services/cleanup";
import { createImapClient } from "../src/server/services/imap";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Bereinigungsregeln", () => {
  it("findet alte Nachrichten oder einen exakten Absender und ignoriert bereits entfernte", () => {
    const { database, accountId, folderId } = testDatabase();
    const oldId = archiveMessage(database, accountId, folderId, 1, "old@example.test", "2020-01-01T10:00:00.000Z");
    archiveMessage(database, accountId, folderId, 2, "new@example.test", new Date().toISOString());

    expect(database.countCleanupCandidates({
      accountId,
      conditionType: "older_than",
      olderThanDays: 365,
    })).toBe(1);
    expect(database.countCleanupCandidates({
      accountId,
      conditionType: "sender",
      sender: "OLD@EXAMPLE.TEST",
    })).toBe(1);

    database.markMessagesRemoteDeleted([oldId]);
    expect(database.countCleanupCandidates({
      accountId,
      conditionType: "older_than",
      olderThanDays: 365,
    })).toBe(0);
    database.close();
  });

  it("pausiert aktive Regeln beim Trennen eines Postfachs", () => {
    const { database, accountId } = testDatabase();
    const rule = database.createCleanupRule({
      accountId,
      conditionType: "older_than",
      olderThanDays: 30,
      enabled: true,
    });

    expect(rule.enabled).toBe(true);
    expect(database.disconnectAccount(accountId)).toBe(true);
    expect(database.getCleanupRule(rule.id)?.enabled).toBe(false);
    database.close();
  });

  it("verschiebt per UID in den IMAP-Papierkorb und behält den Archivdatensatz", async () => {
    const { database, directory, accountId, folderId, vault } = testDatabase();
    const messageId = archiveMessage(database, accountId, folderId, 17, "sender@example.test", "2025-01-01T10:00:00.000Z");
    const messageMove = vi.fn(async () => ({ path: "INBOX", destination: "Papierkorb" }));
    const fakeClient = {
      mailbox: false,
      connect: vi.fn(async () => undefined),
      list: vi.fn(async () => [trashFolder()]),
      getMailboxLock: vi.fn(async function (this: { mailbox: unknown }) {
        this.mailbox = { uidValidity: 42n };
        return { path: "INBOX", release: vi.fn() };
      }),
      search: vi.fn(async () => [17]),
      messageMove,
    };
    const manager = new CleanupManager(
      database,
      vault,
      () => false,
      (() => fakeClient as unknown as ImapFlow) as typeof createImapClient,
      async () => undefined,
    );

    const result = await manager.trashMessages([messageId]);

    expect(result.movedIds).toEqual([messageId]);
    expect(result.failed).toEqual([]);
    expect(messageMove).toHaveBeenCalledWith([17], "Papierkorb", { uid: true });
    expect(database.getMessage(messageId)?.remoteDeletedAt).not.toBeNull();
    expect(database.getMessage(messageId)?.subject).toBe("Testnachricht");
    expect(fs.existsSync(directory)).toBe(true);
    database.close();
  });

  it("bricht ohne eindeutig markierten IMAP-Papierkorb sicher ab", async () => {
    const { database, accountId, folderId, vault } = testDatabase();
    const messageId = archiveMessage(database, accountId, folderId, 18, "sender@example.test", "2025-01-01T10:00:00.000Z");
    const messageMove = vi.fn();
    const fakeClient = {
      connect: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      messageMove,
    };
    const manager = new CleanupManager(
      database,
      vault,
      () => false,
      (() => fakeClient as unknown as ImapFlow) as typeof createImapClient,
      async () => undefined,
    );

    const result = await manager.trashMessages([messageId]);

    expect(result.moved).toBe(0);
    expect(result.failed[0]?.error).toContain("keinen Papierkorb");
    expect(messageMove).not.toHaveBeenCalled();
    expect(database.getMessage(messageId)?.remoteDeletedAt).toBeNull();
    database.close();
  });
});

function testDatabase(): {
  database: StoreDatabase;
  directory: string;
  accountId: string;
  folderId: string;
  vault: CredentialVault;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-cleanup-"));
  temporaryDirectories.push(directory);
  const database = new StoreDatabase(path.join(directory, "archivhafen.sqlite"));
  const vault = new CredentialVault(directory);
  const account = database.createAccount(accountInput(), vault.encrypt("app-passwort"));
  const folder = database.upsertFolder({
    accountId: account.id,
    path: "INBOX",
    name: "Posteingang",
    specialUse: "\\Inbox",
  });
  database.updateFolderState(folder.id, "42", 17, 1);
  return { database, directory, accountId: account.id, folderId: folder.id, vault };
}

function archiveMessage(
  database: StoreDatabase,
  accountId: string,
  folderId: string,
  uid: number,
  sender: string,
  sentAt: string,
): string {
  return database.archiveMessage({
    accountId,
    folderId,
    uidValidity: "42",
    imapUid: uid,
    messageId: `<${uid}@example.test>`,
    subject: "Testnachricht",
    sender: { name: "Test", address: sender },
    recipients: [{ name: "Empfänger", address: "recipient@example.test" }],
    cc: [],
    sentAt,
    receivedAt: sentAt,
    preview: "Vorschau",
    searchBody: "Vorschau",
    flags: [],
    size: 100,
    rawPath: `archive/test/${uid}.eml`,
    contentHash: `hash-${uid}`,
    hasAttachments: false,
    attachmentCount: 0,
  }).id;
}

function accountInput(): AccountInput {
  return {
    name: "Testpostfach",
    email: "mailbox@example.test",
    provider: "custom",
    imapHost: "imap.example.test",
    imapPort: 993,
    imapSecure: true,
    username: "mailbox@example.test",
    password: "not-stored-here",
  };
}

function trashFolder(): ListResponse {
  return {
    path: "Papierkorb",
    pathAsListed: "Papierkorb",
    name: "Papierkorb",
    delimiter: "/",
    parent: [],
    parentPath: "",
    flags: new Set(),
    specialUse: "\\Trash",
    listed: true,
    subscribed: true,
  };
}
