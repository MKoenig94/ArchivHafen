import { ImapFlow, type ListResponse } from "imapflow";
import type { AccountInput, ConnectionTestResult, SyncJob } from "../../shared/types.js";
import type { StoreDatabase } from "../database.js";
import type { CredentialVault } from "../crypto.js";
import type { ArchiveService } from "./archive.js";

const SKIPPED_SPECIAL_FOLDERS = new Set(["\\Trash", "\\Junk"]);
const FETCH_BATCH_SIZE = 40;

export async function testImapConnection(input: AccountInput): Promise<ConnectionTestResult> {
  const client = createImapClient({
    host: input.imapHost,
    port: input.imapPort,
    secure: input.imapSecure,
    username: input.username,
    password: input.password,
  });

  try {
    await client.connect();
    const folders = await client.list();
    return {
      ok: true,
      serverName: input.imapHost,
      folders: folders
        .filter(isSelectableFolder)
        .map((folder) => ({ path: folder.path, specialUse: folder.specialUse ?? null })),
    };
  } finally {
    await closeImapClient(client);
  }
}

export class SyncManager {
  private queue: Promise<void> = Promise.resolve();
  private readonly activeByAccount = new Map<string, string>();
  private afterSuccessfulSync: ((accountId: string) => void) | null = null;

  constructor(
    private readonly database: StoreDatabase,
    private readonly vault: CredentialVault,
    private readonly archive: ArchiveService,
  ) {}

  setAfterSuccessfulSync(callback: (accountId: string) => void): void {
    this.afterSuccessfulSync = callback;
  }

  isActive(accountId: string): boolean {
    return this.activeByAccount.has(accountId);
  }

  start(accountId: string): SyncJob {
    const activeId = this.activeByAccount.get(accountId);
    if (activeId) return this.database.getJob(activeId)!;

    const job = this.database.createJob(accountId);
    this.activeByAccount.set(accountId, job.id);
    const run = async () => {
      let completed = false;
      try {
        completed = await this.syncAccount(job.id, accountId);
      } finally {
        this.activeByAccount.delete(accountId);
      }
      if (completed) this.afterSuccessfulSync?.(accountId);
    };
    this.queue = this.queue.then(run, run);
    return job;
  }

  startAll(): SyncJob[] {
    return this.database.listAccounts(false).map((account) => this.start(account.id));
  }

  private async syncAccount(jobId: string, accountId: string): Promise<boolean> {
    const account = this.database.getAccountRecord(accountId);
    const now = new Date().toISOString();
    if (!account || !account.connected || !account.secretEncrypted) {
      this.database.updateJob(jobId, {
        status: "failed",
        phase: "Nicht verbunden",
        error: "Das Postfach ist nicht mehr verbunden.",
        startedAt: now,
        finishedAt: now,
      });
      return false;
    }

    this.database.updateJob(jobId, {
      status: "running",
      phase: "Verbindung wird hergestellt …",
      startedAt: now,
    });
    this.database.setAccountSyncState(accountId, { status: "syncing" });

    const client = createImapClient({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      username: account.username,
      password: this.vault.decrypt(account.secretEncrypted),
    });

    let processed = 0;
    let total = 0;
    let added = 0;

    try {
      await client.connect();
      const listed = (await client.list({
        statusQuery: { messages: true, uidNext: true, uidValidity: true },
      })).filter(isArchivableFolder);

      for (const listedFolder of listed) {
        const folder = this.database.upsertFolder({
          accountId,
          path: listedFolder.path,
          name: listedFolder.name || listedFolder.path,
          specialUse: listedFolder.specialUse ?? null,
        });
        const lock = await client.getMailboxLock(listedFolder.path, {
          description: `Archiv Hafen sync ${jobId}`,
        });
        try {
          if (!client.mailbox) continue;
          const uidValidity = client.mailbox.uidValidity.toString();
          const state = this.database.getFolderState(folder.id);
          const firstUid = state?.uidValidity === uidValidity ? state.lastUid + 1 : 1;
          const uidNext = client.mailbox.uidNext;
          const messageCount = client.mailbox.exists;

          if (firstUid >= uidNext) {
            this.database.updateFolderState(
              folder.id,
              uidValidity,
              Math.max(0, uidNext - 1),
              messageCount,
            );
            continue;
          }

          const found = await client.search({ uid: `${firstUid}:*` }, { uid: true });
          const uids = found || [];
          total += uids.length;
          this.database.updateJob(jobId, {
            phase: `${listedFolder.name || listedFolder.path} wird archiviert …`,
            total,
          });

          let lastUid = state?.uidValidity === uidValidity ? state.lastUid : 0;
          for (let offset = 0; offset < uids.length; offset += FETCH_BATCH_SIZE) {
            const batch = uids.slice(offset, offset + FETCH_BATCH_SIZE);
            for await (const message of client.fetch(batch, {
              uid: true,
              flags: true,
              source: true,
              internalDate: true,
              size: true,
            }, { uid: true })) {
              if (!message.source) continue;
              const result = await this.archive.archive({
                accountId,
                folderId: folder.id,
                uidValidity,
                imapUid: message.uid,
                source: message.source,
                flags: message.flags,
                internalDate: message.internalDate,
              });
              processed += 1;
              if (result.inserted) added += 1;
              lastUid = Math.max(lastUid, message.uid);
              this.database.updateJob(jobId, { processed, total, added });
            }
          }
          this.database.updateFolderState(folder.id, uidValidity, lastUid, messageCount);
        } finally {
          lock.release();
        }
      }

      this.database.setAccountSyncState(accountId, { status: "ready", completed: true });
      this.database.updateJob(jobId, {
        status: "completed",
        phase: added === 1 ? "1 neue Nachricht archiviert" : `${added} neue Nachrichten archiviert`,
        processed,
        total,
        added,
        finishedAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      const message = friendlyImapError(error);
      this.database.setAccountSyncState(accountId, { status: "error", error: message });
      this.database.updateJob(jobId, {
        status: "failed",
        phase: "Synchronisierung fehlgeschlagen",
        processed,
        total,
        added,
        error: message,
        finishedAt: new Date().toISOString(),
      });
      return false;
    } finally {
      await closeImapClient(client);
    }
  }
}

export function createImapClient(input: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}): ImapFlow {
  return new ImapFlow({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.username, pass: input.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    maxLiteralSize: 150 * 1024 * 1024,
    clientInfo: {
      name: "Archiv Hafen",
      version: "0.2.0",
      vendor: "Local-first",
    },
  });
}

function isSelectableFolder(folder: ListResponse): boolean {
  return !folder.flags.has("\\Noselect");
}

function isArchivableFolder(folder: ListResponse): boolean {
  return isSelectableFolder(folder) && !SKIPPED_SPECIAL_FOLDERS.has(folder.specialUse ?? "");
}

export async function closeImapClient(client: ImapFlow): Promise<void> {
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    client.close();
  }
}

export function friendlyImapError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.toLowerCase();
  if (normalized.includes("authentication") || normalized.includes("login") || normalized.includes("credentials")) {
    return "Anmeldung fehlgeschlagen. Prüfe Benutzername und App-Passwort.";
  }
  if (normalized.includes("certificate") || normalized.includes("tls")) {
    return "Die verschlüsselte Verbindung zum IMAP-Server konnte nicht geprüft werden.";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "Der IMAP-Server antwortet nicht. Prüfe Host, Port und Netzwerk.";
  }
  if (normalized.includes("enotfound") || normalized.includes("getaddrinfo")) {
    return "Der IMAP-Server wurde nicht gefunden. Prüfe den Hostnamen.";
  }
  return raw.replace(/[\r\n]+/g, " ").slice(0, 300) || "Unbekannter IMAP-Fehler";
}
