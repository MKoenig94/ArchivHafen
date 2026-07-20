import type { ImapFlow, ListResponse } from "imapflow";
import type {
  CleanupPreview,
  CleanupRule,
  CleanupRuleInput,
  TrashMessagesResult,
} from "../../shared/types.js";
import type { CredentialVault } from "../crypto.js";
import type { RemoteMessageRecord, StoreDatabase } from "../database.js";
import { closeImapClient, createImapClient, friendlyImapError } from "./imap.js";

export class CleanupManager {
  private queue: Promise<void> = Promise.resolve();
  private readonly activeRules = new Set<string>();

  constructor(
    private readonly database: StoreDatabase,
    private readonly vault: CredentialVault,
    private readonly accountIsBusy: (accountId: string) => boolean = () => false,
    private readonly clientFactory: typeof createImapClient = createImapClient,
    private readonly closeClient: typeof closeImapClient = closeImapClient,
  ) {}

  preview(input: CleanupRuleInput): CleanupPreview {
    return {
      count: this.database.countCleanupCandidates(input),
      examples: this.database.listCleanupCandidateSummaries(input),
    };
  }

  async trashMessages(ids: string[]): Promise<TrashMessagesResult> {
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    const records = this.database.getRemoteMessageRecords(uniqueIds);
    const foundIds = new Set(records.map((record) => record.id));
    const missing = uniqueIds
      .filter((id) => !foundIds.has(id))
      .map((id) => ({ id, error: "Die Archivnachricht wurde nicht gefunden." }));
    return this.enqueue(async () => {
      const result = await this.moveRecords(records);
      return {
        requested: uniqueIds.length,
        moved: result.movedIds.length,
        movedIds: result.movedIds,
        failed: [...missing, ...result.failed],
      };
    });
  }

  isRuleActive(id: string): boolean {
    return this.activeRules.has(id);
  }

  async runRule(id: string, requireEnabled = false): Promise<TrashMessagesResult> {
    if (this.activeRules.has(id)) {
      throw new CleanupRequestError("Diese Regel wird bereits ausgeführt.", 409);
    }
    if (!this.database.getCleanupRule(id)) {
      throw new CleanupRequestError("Regel nicht gefunden.", 404);
    }
    this.activeRules.add(id);
    try {
      return await this.enqueue(async () => {
        const rule = this.database.getCleanupRule(id);
        if (!rule || (requireEnabled && !rule.enabled)) {
          return emptyTrashResult();
        }
        const records = this.database.listCleanupCandidateRecords(ruleInput(rule));
        const result = await this.moveRecords(records);
        const error = result.failed.length
          ? `${result.failed.length} Nachrichten konnten nicht verschoben werden.`
          : null;
        this.database.recordCleanupRuleRun(id, records.length, result.movedIds.length, error);
        return {
          requested: records.length,
          moved: result.movedIds.length,
          movedIds: result.movedIds,
          failed: result.failed,
        };
      });
    } catch (error) {
      this.database.recordCleanupRuleRun(id, 0, 0, friendlyImapError(error));
      throw error;
    } finally {
      this.activeRules.delete(id);
    }
  }

  runEnabledForAccount(accountId: string): void {
    for (const rule of this.database.listCleanupRules()) {
      if (rule.accountId === accountId && rule.enabled && !this.activeRules.has(rule.id)) {
        void this.runRule(rule.id, true).catch((error) => {
          console.error(`Bereinigungsregel ${rule.id} fehlgeschlagen: ${friendlyImapError(error)}`);
        });
      }
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async moveRecords(records: RemoteMessageRecord[]): Promise<{
    movedIds: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const movedIds: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    const pending = records.filter((record) => {
      if (record.remoteDeletedAt) {
        failed.push({ id: record.id, error: "Die Nachricht wurde bereits in den Papierkorb verschoben." });
        return false;
      }
      if (this.accountIsBusy(record.accountId)) {
        failed.push({ id: record.id, error: "Für dieses Postfach läuft gerade eine Archivierung." });
        return false;
      }
      return true;
    });

    const byAccount = groupBy(pending, (record) => record.accountId);
    for (const [accountId, accountRecords] of byAccount) {
      const account = this.database.getAccountRecord(accountId);
      if (!account?.connected || !account.secretEncrypted) {
        failAll(failed, accountRecords, "Das Postfach ist nicht verbunden.");
        continue;
      }

      const client = this.clientFactory({
        host: account.imapHost,
        port: account.imapPort,
        secure: account.imapSecure,
        username: account.username,
        password: this.vault.decrypt(account.secretEncrypted),
      });
      try {
        await client.connect();
        const folders = await client.list();
        const trash = findTrashFolder(folders);
        if (!trash) {
          failAll(failed, accountRecords, "Der IMAP-Server meldet keinen Papierkorb.");
          continue;
        }
        const bySource = groupBy(
          accountRecords,
          (record) => `${record.folderPath}\u0000${record.uidValidity}`,
        );
        for (const sourceRecords of bySource.values()) {
          await this.moveSourceGroup(client, trash.path, sourceRecords, movedIds, failed);
        }
      } catch (error) {
        const completed = new Set([...movedIds, ...failed.map((item) => item.id)]);
        failAll(
          failed,
          accountRecords.filter((record) => !completed.has(record.id)),
          friendlyImapError(error),
        );
      } finally {
        await this.closeClient(client);
      }
    }
    return { movedIds, failed };
  }

  private async moveSourceGroup(
    client: ImapFlow,
    trashPath: string,
    records: RemoteMessageRecord[],
    movedIds: string[],
    failed: Array<{ id: string; error: string }>,
  ): Promise<void> {
    const first = records[0];
    if (!first) return;
    if (first.folderPath === trashPath || first.folderSpecialUse === "\\Trash") {
      failAll(failed, records, "Die Nachricht befindet sich bereits im Papierkorb.");
      return;
    }
    const lock = await client.getMailboxLock(first.folderPath, {
      readOnly: false,
      description: "Archiv Hafen cleanup",
    });
    try {
      if (!client.mailbox || client.mailbox.uidValidity.toString() !== first.uidValidity) {
        failAll(failed, records, "Der Ordner hat sich auf dem Server geändert. Bitte zuerst neu synchronisieren.");
        return;
      }
      for (const batch of chunks(records, 100)) {
        const uids = batch.map((record) => record.imapUid);
        const existing = await client.search({ uid: uids.join(",") }, { uid: true });
        const existingUids = new Set(existing || []);
        const present = batch.filter((record) => existingUids.has(record.imapUid));
        const missing = batch.filter((record) => !existingUids.has(record.imapUid));
        failAll(failed, missing, "Die Nachricht liegt nicht mehr im archivierten Serverordner.");
        if (!present.length) continue;
        const response = await client.messageMove(
          present.map((record) => record.imapUid),
          trashPath,
          { uid: true },
        );
        if (!response) {
          failAll(failed, present, "Der IMAP-Server hat die Nachricht nicht verschoben.");
          continue;
        }
        const ids = present.map((record) => record.id);
        this.database.markMessagesRemoteDeleted(ids);
        movedIds.push(...ids);
      }
    } finally {
      lock.release();
    }
  }
}

function emptyTrashResult(): TrashMessagesResult {
  return { requested: 0, moved: 0, movedIds: [], failed: [] };
}

export class CleanupRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function findTrashFolder(folders: ListResponse[]): ListResponse | null {
  return folders.find((folder) => folder.specialUse === "\\Trash" && !folder.flags.has("\\Noselect")) ?? null;
}

function ruleInput(rule: CleanupRule): CleanupRuleInput {
  return {
    accountId: rule.accountId,
    conditionType: rule.conditionType,
    olderThanDays: rule.olderThanDays ?? undefined,
    sender: rule.sender ?? undefined,
    enabled: rule.enabled,
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

function failAll(
  target: Array<{ id: string; error: string }>,
  records: RemoteMessageRecord[],
  error: string,
): void {
  target.push(...records.map((record) => ({ id: record.id, error })));
}
