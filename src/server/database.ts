import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  Account,
  AccountInput,
  DashboardStats,
  Folder,
  MessageAddress,
  MessagePage,
  MessageSummary,
  SyncJob,
} from "../shared/types.js";

type Row = Record<string, unknown>;

export interface AccountRecord extends Account {
  secretEncrypted: string;
}

export interface ArchiveMessageInput {
  id?: string;
  accountId: string;
  folderId: string;
  uidValidity: string;
  imapUid: number;
  messageId: string | null;
  subject: string;
  sender: MessageAddress;
  recipients: MessageAddress[];
  cc: MessageAddress[];
  sentAt: string | null;
  receivedAt: string | null;
  preview: string;
  searchBody: string;
  flags: string[];
  size: number;
  rawPath: string;
  contentHash: string;
  hasAttachments: boolean;
  attachmentCount: number;
}

export interface MessageRecord extends MessageSummary {
  rawPath: string;
  cc: MessageAddress[];
  messageId: string | null;
}

export class StoreDatabase {
  readonly connection: DatabaseSync;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(databasePath);
    this.connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
    this.recoverInterruptedSyncs();
  }

  close(): void {
    this.connection.close();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        provider TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        imap_secure INTEGER NOT NULL,
        username TEXT NOT NULL,
        secret_encrypted TEXT NOT NULL,
        color TEXT NOT NULL,
        connected INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_sync_at TEXT,
        status TEXT NOT NULL DEFAULT 'ready',
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        special_use TEXT,
        uid_validity TEXT,
        last_uid INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        UNIQUE(account_id, path)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
        uid_validity TEXT NOT NULL,
        imap_uid INTEGER NOT NULL,
        message_id TEXT,
        subject TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        recipients_json TEXT NOT NULL,
        cc_json TEXT NOT NULL,
        sent_at TEXT,
        received_at TEXT,
        preview TEXT NOT NULL,
        flags_json TEXT NOT NULL,
        size INTEGER NOT NULL,
        raw_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        attachment_count INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT NOT NULL,
        UNIQUE(folder_id, uid_validity, imap_uid)
      );

      CREATE INDEX IF NOT EXISTS messages_account_idx ON messages(account_id);
      CREATE INDEX IF NOT EXISTS messages_folder_idx ON messages(folder_id);
      CREATE INDEX IF NOT EXISTS messages_date_idx ON messages(sent_at DESC, received_at DESC);
      CREATE INDEX IF NOT EXISTS messages_hash_idx ON messages(content_hash);
      CREATE UNIQUE INDEX IF NOT EXISTS messages_account_hash_unique
        ON messages(account_id, content_hash);

      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
        message_id UNINDEXED,
        subject,
        sender,
        recipients,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        added INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  private recoverInterruptedSyncs(): void {
    const now = new Date().toISOString();
    this.connection.prepare(`
      UPDATE sync_jobs SET
        status = 'failed',
        phase = 'Durch Neustart unterbrochen',
        error = 'Der vorherige Lauf wurde durch einen Neustart unterbrochen.',
        finished_at = ?
      WHERE status IN ('queued', 'running')
    `).run(now);
    this.connection.prepare(`
      UPDATE accounts SET
        status = 'error',
        last_error = 'Die letzte Archivierung wurde durch einen Neustart unterbrochen.'
      WHERE status = 'syncing'
    `).run();
  }

  createAccount(input: AccountInput, encryptedPassword: string): Account {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const color = input.color ?? accountColor(input.email);
    this.connection.prepare(`
      INSERT INTO accounts (
        id, name, email, provider, imap_host, imap_port, imap_secure,
        username, secret_encrypted, color, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.email.toLowerCase(), input.provider, input.imapHost,
      input.imapPort, input.imapSecure ? 1 : 0, input.username, encryptedPassword, color, createdAt);
    return this.getAccount(id)!;
  }

  reconnectAccount(id: string, input: AccountInput, encryptedPassword: string): Account | null {
    const result = this.connection.prepare(`
      UPDATE accounts SET
        name = ?, email = ?, provider = ?, imap_host = ?, imap_port = ?,
        imap_secure = ?, username = ?, secret_encrypted = ?, color = ?,
        connected = 1, status = 'ready', last_error = NULL
      WHERE id = ?
    `).run(
      input.name,
      input.email.toLowerCase(),
      input.provider,
      input.imapHost,
      input.imapPort,
      input.imapSecure ? 1 : 0,
      input.username,
      encryptedPassword,
      input.color ?? accountColor(input.email),
      id,
    );
    return Number(result.changes) > 0 ? this.getAccount(id) : null;
  }

  listAccounts(includeDisconnected = true): Account[] {
    const where = includeDisconnected ? "" : "WHERE a.connected = 1";
    const rows = this.connection.prepare(`
      SELECT a.*, COUNT(m.id) AS message_count
      FROM accounts a
      LEFT JOIN messages m ON m.account_id = a.id
      ${where}
      GROUP BY a.id
      ORDER BY a.connected DESC, a.created_at ASC
    `).all() as Row[];
    return rows.map(mapAccount);
  }

  getAccount(id: string): Account | null {
    const row = this.connection.prepare(`
      SELECT a.*, COUNT(m.id) AS message_count
      FROM accounts a LEFT JOIN messages m ON m.account_id = a.id
      WHERE a.id = ? GROUP BY a.id
    `).get(id) as Row | undefined;
    return row ? mapAccount(row) : null;
  }

  getAccountRecord(id: string): AccountRecord | null {
    const row = this.connection.prepare(`
      SELECT a.*, COUNT(m.id) AS message_count
      FROM accounts a LEFT JOIN messages m ON m.account_id = a.id
      WHERE a.id = ? GROUP BY a.id
    `).get(id) as Row | undefined;
    if (!row) return null;
    return { ...mapAccount(row), secretEncrypted: String(row.secret_encrypted) };
  }

  disconnectAccount(id: string): boolean {
    const result = this.connection.prepare(`
      UPDATE accounts
      SET connected = 0, secret_encrypted = '', status = 'disconnected', last_error = NULL
      WHERE id = ?
    `).run(id);
    return Number(result.changes) > 0;
  }

  setAccountSyncState(
    id: string,
    state: { status: Account["status"]; error?: string | null; completed?: boolean },
  ): void {
    this.connection.prepare(`
      UPDATE accounts SET status = ?, last_error = ?,
        last_sync_at = CASE WHEN ? THEN ? ELSE last_sync_at END
      WHERE id = ?
    `).run(state.status, state.error ?? null, state.completed ? 1 : 0,
      new Date().toISOString(), id);
  }

  upsertFolder(input: {
    accountId: string;
    path: string;
    name: string;
    specialUse: string | null;
  }): Folder {
    const existing = this.connection.prepare(
      "SELECT id FROM folders WHERE account_id = ? AND path = ?",
    ).get(input.accountId, input.path) as Row | undefined;
    const id = existing ? String(existing.id) : randomUUID();
    this.connection.prepare(`
      INSERT INTO folders (id, account_id, path, name, special_use)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, path) DO UPDATE SET
        name = excluded.name, special_use = excluded.special_use
    `).run(id, input.accountId, input.path, input.name, input.specialUse);
    return this.getFolder(id)!;
  }

  getFolder(id: string): Folder | null {
    const row = this.connection.prepare(`
      SELECT f.*, COUNT(m.id) AS archived_count
      FROM folders f LEFT JOIN messages m ON m.folder_id = f.id
      WHERE f.id = ? GROUP BY f.id
    `).get(id) as Row | undefined;
    return row ? mapFolder(row) : null;
  }

  getFolderState(id: string): { uidValidity: string | null; lastUid: number } | null {
    const row = this.connection.prepare(
      "SELECT uid_validity, last_uid FROM folders WHERE id = ?",
    ).get(id) as Row | undefined;
    return row ? {
      uidValidity: row.uid_validity === null ? null : String(row.uid_validity),
      lastUid: Number(row.last_uid),
    } : null;
  }

  listFolders(accountId?: string): Folder[] {
    const filter = accountId ? "WHERE f.account_id = ?" : "";
    const params: SQLInputValue[] = accountId ? [accountId] : [];
    const rows = this.connection.prepare(`
      SELECT f.*, COUNT(m.id) AS archived_count
      FROM folders f LEFT JOIN messages m ON m.folder_id = f.id
      ${filter}
      GROUP BY f.id
      ORDER BY f.account_id, CASE f.special_use
        WHEN '\\Inbox' THEN 0 WHEN '\\Sent' THEN 1 WHEN '\\Archive' THEN 2 ELSE 3 END, f.name
    `).all(...params) as Row[];
    return rows.map(mapFolder);
  }

  updateFolderState(id: string, uidValidity: string, lastUid: number, messageCount: number): void {
    this.connection.prepare(`
      UPDATE folders SET uid_validity = ?, last_uid = ?, message_count = ?, last_sync_at = ?
      WHERE id = ?
    `).run(uidValidity, lastUid, messageCount, new Date().toISOString(), id);
  }

  archiveMessage(input: ArchiveMessageInput): { id: string; inserted: boolean } {
    const id = input.id ?? randomUUID();
    const archivedAt = new Date().toISOString();
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = this.connection.prepare(`
        INSERT OR IGNORE INTO messages (
          id, account_id, folder_id, uid_validity, imap_uid, message_id, subject,
          sender_name, sender_email, recipients_json, cc_json, sent_at, received_at,
          preview, flags_json, size, raw_path, content_hash, has_attachments,
          attachment_count, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.accountId, input.folderId, input.uidValidity, input.imapUid,
        input.messageId, input.subject, input.sender.name, input.sender.address,
        JSON.stringify(input.recipients), JSON.stringify(input.cc), input.sentAt,
        input.receivedAt, input.preview, JSON.stringify(input.flags), input.size,
        input.rawPath, input.contentHash, input.hasAttachments ? 1 : 0,
        input.attachmentCount, archivedAt,
      );
      const inserted = Number(result.changes) > 0;
      if (inserted) {
        this.connection.prepare(`
          INSERT INTO message_search (message_id, subject, sender, recipients, body)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          id,
          input.subject,
          `${input.sender.name} ${input.sender.address}`,
          input.recipients.map((item) => `${item.name} ${item.address}`).join(" "),
          input.searchBody.slice(0, 250_000),
        );
      }
      this.connection.exec("COMMIT");
      return { id, inserted };
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  listMessages(options: {
    page?: number;
    pageSize?: number;
    query?: string;
    accountId?: string;
    folderId?: string;
    attachmentsOnly?: boolean;
  }): MessagePage {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 40));
    const where: string[] = [];
    const params: SQLInputValue[] = [];

    if (options.accountId) {
      where.push("m.account_id = ?");
      params.push(options.accountId);
    }
    if (options.folderId) {
      where.push("m.folder_id = ?");
      params.push(options.folderId);
    }
    if (options.attachmentsOnly) where.push("m.has_attachments = 1");
    if (options.query?.trim()) {
      const fts = toFtsQuery(options.query);
      if (fts) {
        where.push("m.id IN (SELECT message_id FROM message_search WHERE message_search MATCH ?)");
        params.push(fts);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const totalRow = this.connection.prepare(`
      SELECT COUNT(*) AS count FROM messages m ${whereSql}
    `).get(...params) as Row;
    const total = Number(totalRow.count);
    const rows = this.connection.prepare(`
      SELECT m.*, a.name AS account_name, a.color AS account_color,
        f.name AS folder_name
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      JOIN folders f ON f.id = m.folder_id
      ${whereSql}
      ORDER BY COALESCE(m.sent_at, m.received_at, m.archived_at) DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as Row[];

    return {
      items: rows.map(mapMessage),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  getMessage(id: string): MessageRecord | null {
    const row = this.connection.prepare(`
      SELECT m.*, a.name AS account_name, a.color AS account_color,
        f.name AS folder_name
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      JOIN folders f ON f.id = m.folder_id
      WHERE m.id = ?
    `).get(id) as Row | undefined;
    if (!row) return null;
    return {
      ...mapMessage(row),
      rawPath: String(row.raw_path),
      cc: parseAddresses(row.cc_json),
      messageId: row.message_id === null ? null : String(row.message_id),
    };
  }

  createJob(accountId: string | null): SyncJob {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.connection.prepare(`
      INSERT INTO sync_jobs (id, account_id, status, phase, created_at)
      VALUES (?, ?, 'queued', 'Wartet …', ?)
    `).run(id, accountId, createdAt);
    return this.getJob(id)!;
  }

  updateJob(id: string, update: Partial<Pick<SyncJob,
    "status" | "phase" | "processed" | "total" | "added" | "error" | "startedAt" | "finishedAt"
  >>): void {
    const fields: string[] = [];
    const values: SQLInputValue[] = [];
    const mapping: Record<string, string> = {
      status: "status", phase: "phase", processed: "processed", total: "total",
      added: "added", error: "error", startedAt: "started_at", finishedAt: "finished_at",
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (key in update) {
        fields.push(`${column} = ?`);
        values.push(update[key as keyof typeof update] ?? null);
      }
    }
    if (!fields.length) return;
    this.connection.prepare(`UPDATE sync_jobs SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values, id);
  }

  getJob(id: string): SyncJob | null {
    const row = this.connection.prepare(`
      SELECT j.*, a.name AS account_name FROM sync_jobs j
      LEFT JOIN accounts a ON a.id = j.account_id WHERE j.id = ?
    `).get(id) as Row | undefined;
    return row ? mapJob(row) : null;
  }

  listJobs(limit = 8): SyncJob[] {
    const rows = this.connection.prepare(`
      SELECT j.*, a.name AS account_name FROM sync_jobs j
      LEFT JOIN accounts a ON a.id = j.account_id
      ORDER BY j.created_at DESC LIMIT ?
    `).all(limit) as Row[];
    return rows.map(mapJob);
  }

  getStats(dataDirectory: string): DashboardStats {
    const counts = this.connection.prepare(`
      SELECT
        (SELECT COUNT(*) FROM messages) AS messages,
        (SELECT COUNT(*) FROM accounts WHERE connected = 1) AS accounts,
        (SELECT COUNT(*) FROM folders) AS folders,
        (SELECT COALESCE(SUM(size), 0) FROM messages) AS storage_bytes,
        (SELECT MAX(last_sync_at) FROM accounts) AS last_sync_at
    `).get() as Row;
    return {
      messages: Number(counts.messages),
      accounts: Number(counts.accounts),
      folders: Number(counts.folders),
      storageBytes: Number(counts.storage_bytes),
      lastSyncAt: counts.last_sync_at === null ? null : String(counts.last_sync_at),
      recentMessages: this.listMessages({ pageSize: 5 }).items,
      recentJobs: this.listJobs(6),
      dataDirectory,
    };
  }
}

function mapAccount(row: Row): Account {
  const connected = Boolean(row.connected);
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    provider: String(row.provider) as Account["provider"],
    imapHost: String(row.imap_host),
    imapPort: Number(row.imap_port),
    imapSecure: Boolean(row.imap_secure),
    username: String(row.username),
    color: String(row.color),
    connected,
    createdAt: String(row.created_at),
    lastSyncAt: row.last_sync_at === null ? null : String(row.last_sync_at),
    status: (connected ? String(row.status) : "disconnected") as Account["status"],
    lastError: row.last_error === null ? null : String(row.last_error),
    messageCount: Number(row.message_count ?? 0),
  };
}

function mapFolder(row: Row): Folder {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    path: String(row.path),
    name: String(row.name),
    specialUse: row.special_use === null ? null : String(row.special_use),
    messageCount: Number(row.archived_count ?? 0),
    lastSyncAt: row.last_sync_at === null ? null : String(row.last_sync_at),
  };
}

function mapMessage(row: Row): MessageSummary {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    accountName: String(row.account_name),
    accountColor: String(row.account_color),
    folderId: String(row.folder_id),
    folder: String(row.folder_name),
    subject: String(row.subject),
    sender: { name: String(row.sender_name), address: String(row.sender_email) },
    recipients: parseAddresses(row.recipients_json),
    sentAt: row.sent_at === null ? null : String(row.sent_at),
    receivedAt: row.received_at === null ? null : String(row.received_at),
    preview: String(row.preview),
    flags: parseStringArray(row.flags_json),
    size: Number(row.size),
    hasAttachments: Boolean(row.has_attachments),
    attachmentCount: Number(row.attachment_count),
    archivedAt: String(row.archived_at),
  };
}

function mapJob(row: Row): SyncJob {
  return {
    id: String(row.id),
    accountId: row.account_id === null ? null : String(row.account_id),
    accountName: row.account_name === null ? null : String(row.account_name),
    status: String(row.status) as SyncJob["status"],
    phase: String(row.phase),
    processed: Number(row.processed),
    total: Number(row.total),
    added: Number(row.added),
    error: row.error === null ? null : String(row.error),
    startedAt: row.started_at === null ? null : String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
  };
}

function parseAddresses(value: unknown): MessageAddress[] {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toFtsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/["*:^(){}[\]]/g, "").trim())
    .filter(Boolean)
    .map((part) => `"${part}"*`)
    .join(" AND ");
}

function accountColor(value: string): string {
  const colors = ["#36634a", "#2f5d78", "#76538c", "#9a5a3a", "#5d6475", "#356b69"];
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}
