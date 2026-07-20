import type {
  Account,
  AccountInput,
  ConnectionTestResult,
  DashboardStats,
  Folder,
  MessageDetail,
  MessagePage,
  SyncJob,
} from "../../shared/types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Anfrage fehlgeschlagen (${response.status})`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep the generic message for non-JSON responses.
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  dashboard: () => request<DashboardStats>("/api/dashboard"),
  accounts: () => request<Account[]>("/api/accounts"),
  folders: (accountId?: string) => request<Folder[]>(
    `/api/folders${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`,
  ),
  messages: (options: {
    page?: number;
    pageSize?: number;
    q?: string;
    accountId?: string;
    folderId?: string;
    attachments?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (options.page) query.set("page", String(options.page));
    if (options.pageSize) query.set("pageSize", String(options.pageSize));
    if (options.q) query.set("q", options.q);
    if (options.accountId) query.set("accountId", options.accountId);
    if (options.folderId) query.set("folderId", options.folderId);
    if (options.attachments) query.set("attachments", "true");
    return request<MessagePage>(`/api/messages?${query}`);
  },
  message: (id: string) => request<MessageDetail>(`/api/messages/${id}`),
  testAccount: (input: AccountInput) => request<ConnectionTestResult>("/api/accounts/test", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  createAccount: (input: AccountInput) => request<Account>("/api/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  reconnectAccount: (id: string, input: AccountInput) => request<Account>(`/api/accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }),
  disconnectAccount: (id: string) => request<void>(`/api/accounts/${id}`, { method: "DELETE" }),
  syncAccount: (id: string) => request<SyncJob>(`/api/accounts/${id}/sync`, { method: "POST" }),
  syncAll: () => request<SyncJob[]>("/api/sync", { method: "POST" }),
  jobs: () => request<SyncJob[]>("/api/jobs?limit=10"),
};
