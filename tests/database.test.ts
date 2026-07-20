import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StoreDatabase } from "../src/server/database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("StoreDatabase", () => {
  it("ergänzt Bereinigungsfelder in einer bestehenden Archivdatenbank", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "archivhafen.sqlite");
    const previousVersion = new StoreDatabase(databasePath);
    previousVersion.connection.exec(`
      DROP INDEX messages_remote_deleted_idx;
      ALTER TABLE messages DROP COLUMN remote_deleted_at;
      ALTER TABLE folders DROP COLUMN delimiter;
      ALTER TABLE folders DROP COLUMN parent_path;
      DROP TABLE cleanup_rules;
    `);
    previousVersion.close();

    const migrated = new StoreDatabase(databasePath);
    const columns = migrated.connection.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    const folderColumns = migrated.connection.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
    const rulesTable = migrated.connection.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cleanup_rules'",
    ).get() as { name: string } | undefined;

    expect(columns.some((column) => column.name === "remote_deleted_at")).toBe(true);
    expect(folderColumns.some((column) => column.name === "delimiter")).toBe(true);
    expect(folderColumns.some((column) => column.name === "parent_path")).toBe(true);
    expect(rulesTable?.name).toBe("cleanup_rules");
    expect(migrated.listCleanupRules()).toEqual([]);
    migrated.close();
  });

  it("markiert einen durch Neustart unterbrochenen Lauf als fehlgeschlagen", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-recovery-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "archivhafen.sqlite");
    const first = new StoreDatabase(databasePath);
    const account = first.createAccount({
      name: "Test",
      email: "test@example.test",
      provider: "custom",
      imapHost: "imap.example.test",
      imapPort: 993,
      imapSecure: true,
      username: "test@example.test",
      password: "irrelevant",
    }, "encrypted-placeholder");
    const job = first.createJob(account.id);
    first.updateJob(job.id, { status: "running", phase: "Posteingang wird archiviert …" });
    first.setAccountSyncState(account.id, { status: "syncing" });
    first.close();

    const reopened = new StoreDatabase(databasePath);
    expect(reopened.getJob(job.id)?.status).toBe("failed");
    expect(reopened.getJob(job.id)?.phase).toBe("Durch Neustart unterbrochen");
    expect(reopened.getAccount(account.id)?.status).toBe("error");
    reopened.close();
  });
});
