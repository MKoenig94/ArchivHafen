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
