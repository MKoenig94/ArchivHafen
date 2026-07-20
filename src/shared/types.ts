export type ProviderId = "gmail" | "microsoft" | "gmx" | "webde" | "icloud" | "custom";

export interface Account {
  id: string;
  name: string;
  email: string;
  provider: ProviderId;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  username: string;
  color: string;
  connected: boolean;
  createdAt: string;
  lastSyncAt: string | null;
  status: "ready" | "syncing" | "error" | "disconnected";
  lastError: string | null;
  messageCount: number;
}

export interface Folder {
  id: string;
  accountId: string;
  path: string;
  name: string;
  specialUse: string | null;
  messageCount: number;
  lastSyncAt: string | null;
}

export interface MessageAddress {
  name: string;
  address: string;
}

export interface MessageSummary {
  id: string;
  accountId: string;
  accountName: string;
  accountColor: string;
  folderId: string;
  folder: string;
  subject: string;
  sender: MessageAddress;
  recipients: MessageAddress[];
  sentAt: string | null;
  receivedAt: string | null;
  preview: string;
  flags: string[];
  size: number;
  hasAttachments: boolean;
  attachmentCount: number;
  archivedAt: string;
}

export interface MessageDetail extends MessageSummary {
  cc: MessageAddress[];
  messageId: string | null;
  text: string;
  html: string | null;
  attachments: Array<{
    index: number;
    filename: string;
    contentType: string;
    size: number;
    contentId: string | null;
  }>;
}

export interface MessagePage {
  items: MessageSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface SyncJob {
  id: string;
  accountId: string | null;
  accountName: string | null;
  status: "queued" | "running" | "completed" | "failed";
  phase: string;
  processed: number;
  total: number;
  added: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DashboardStats {
  messages: number;
  accounts: number;
  folders: number;
  storageBytes: number;
  lastSyncAt: string | null;
  recentMessages: MessageSummary[];
  recentJobs: SyncJob[];
  dataDirectory: string;
}

export interface AccountInput {
  name: string;
  email: string;
  provider: ProviderId;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  username: string;
  password: string;
  color?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  serverName: string;
  folders: Array<{ path: string; specialUse: string | null }>;
}
