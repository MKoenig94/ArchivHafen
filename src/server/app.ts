import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import sanitizeHtml from "sanitize-html";
import { z, ZodError } from "zod";
import type { AccountInput, CleanupRuleInput, ProviderId } from "../shared/types.js";
import type { StoreDatabase } from "./database.js";
import type { CredentialVault } from "./crypto.js";
import type { ArchiveService } from "./services/archive.js";
import { CleanupRequestError, type CleanupManager } from "./services/cleanup.js";
import { friendlyImapError, type SyncManager, testImapConnection } from "./services/imap.js";

interface Services {
  database: StoreDatabase;
  vault: CredentialVault;
  archive: ArchiveService;
  sync: SyncManager;
  cleanup: CleanupManager;
  dataDirectory: string;
  production?: boolean;
}

const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  provider: z.enum(["gmail", "microsoft", "gmx", "webde", "icloud", "custom"]),
  imapHost: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(4096),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const idSchema = z.string().uuid();
const cleanupRuleSchema = z.discriminatedUnion("conditionType", [
  z.object({
    accountId: idSchema,
    conditionType: z.literal("older_than"),
    olderThanDays: z.coerce.number().int().min(1).max(36_500),
    enabled: z.boolean().optional(),
  }),
  z.object({
    accountId: idSchema,
    conditionType: z.literal("sender"),
    sender: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    enabled: z.boolean().optional(),
  }),
]);
const trashMessagesSchema = z.object({
  ids: z.array(idSchema).min(1).max(100),
});

export function createApp(services: Services) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: services.production ? undefined : false,
    crossOriginResourcePolicy: { policy: "same-origin" },
  }));
  app.use(express.json({ limit: "128kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, service: "archivhafen" });
  });

  app.get("/api/dashboard", (_request, response) => {
    response.json(services.database.getStats(services.dataDirectory));
  });

  app.get("/api/accounts", (_request, response) => {
    response.json(services.database.listAccounts());
  });

  app.post("/api/accounts/test", async (request, response) => {
    const input = accountSchema.parse(request.body) as AccountInput;
    try {
      response.json(await testImapConnection(input));
    } catch (error) {
      response.status(422).json({ error: friendlyImapError(error) });
    }
  });

  app.post("/api/accounts", (request, response) => {
    const input = accountSchema.parse(request.body) as AccountInput;
    const account = services.database.createAccount(input, services.vault.encrypt(input.password));
    response.status(201).json(account);
  });

  app.put("/api/accounts/:id", (request, response) => {
    const id = idSchema.parse(request.params.id);
    const input = accountSchema.parse(request.body) as AccountInput;
    const account = services.database.reconnectAccount(id, input, services.vault.encrypt(input.password));
    if (!account) return response.status(404).json({ error: "Postfach nicht gefunden." });
    response.json(account);
  });

  app.delete("/api/accounts/:id", (request, response) => {
    const id = idSchema.parse(request.params.id);
    const disconnected = services.database.disconnectAccount(id);
    if (!disconnected) return response.status(404).json({ error: "Postfach nicht gefunden." });
    response.status(204).end();
  });

  app.get("/api/folders", (request, response) => {
    const accountId = request.query.accountId
      ? idSchema.parse(request.query.accountId)
      : undefined;
    response.json(services.database.listFolders(accountId));
  });

  app.post("/api/sync", (_request, response) => {
    const jobs = services.sync.startAll();
    response.status(202).json(jobs);
  });

  app.post("/api/accounts/:id/sync", (request, response) => {
    const id = idSchema.parse(request.params.id);
    const account = services.database.getAccount(id);
    if (!account) return response.status(404).json({ error: "Postfach nicht gefunden." });
    if (!account.connected) return response.status(409).json({ error: "Postfach ist nicht verbunden." });
    response.status(202).json(services.sync.start(id));
  });

  app.get("/api/jobs", (request, response) => {
    const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 10));
    response.json(services.database.listJobs(limit));
  });

  app.get("/api/jobs/:id", (request, response) => {
    const id = idSchema.parse(request.params.id);
    const job = services.database.getJob(id);
    if (!job) return response.status(404).json({ error: "Vorgang nicht gefunden." });
    response.json(job);
  });

  app.get("/api/cleanup-rules", (_request, response) => {
    response.json(services.database.listCleanupRules());
  });

  app.post("/api/cleanup-rules/preview", (request, response) => {
    const input = cleanupRuleSchema.parse(request.body) as CleanupRuleInput;
    const account = services.database.getAccount(input.accountId);
    if (!account) return response.status(404).json({ error: "Postfach nicht gefunden." });
    response.json(services.cleanup.preview(input));
  });

  app.post("/api/cleanup-rules", (request, response) => {
    const input = cleanupRuleSchema.parse(request.body) as CleanupRuleInput;
    const account = services.database.getAccount(input.accountId);
    if (!account) return response.status(404).json({ error: "Postfach nicht gefunden." });
    if (!account.connected) return response.status(409).json({ error: "Postfach ist nicht verbunden." });
    response.status(201).json(services.database.createCleanupRule(input));
  });

  app.patch("/api/cleanup-rules/:id", (request, response) => {
    const id = idSchema.parse(request.params.id);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    if (services.cleanup.isRuleActive(id)) {
      return response.status(409).json({ error: "Die Regel läuft gerade. Bitte versuche es danach erneut." });
    }
    const rule = services.database.setCleanupRuleEnabled(id, enabled);
    if (!rule) return response.status(404).json({ error: "Regel nicht gefunden." });
    response.json(rule);
  });

  app.delete("/api/cleanup-rules/:id", (request, response) => {
    const id = idSchema.parse(request.params.id);
    if (services.cleanup.isRuleActive(id)) {
      return response.status(409).json({ error: "Die Regel läuft gerade. Bitte versuche es danach erneut." });
    }
    if (!services.database.deleteCleanupRule(id)) {
      return response.status(404).json({ error: "Regel nicht gefunden." });
    }
    response.status(204).end();
  });

  app.post("/api/cleanup-rules/:id/run", async (request, response) => {
    const id = idSchema.parse(request.params.id);
    response.json(await services.cleanup.runRule(id));
  });

  app.get("/api/messages", (request, response) => {
    const page = numberQuery(request.query.page, 1);
    const pageSize = numberQuery(request.query.pageSize, 40);
    const query = stringQuery(request.query.q);
    const accountId = optionalUuid(request.query.accountId);
    const folderId = optionalUuid(request.query.folderId);
    const attachmentsOnly = request.query.attachments === "true";
    response.json(services.database.listMessages({
      page, pageSize, query, accountId, folderId, attachmentsOnly,
    }));
  });

  app.post("/api/messages/trash", async (request, response) => {
    const { ids } = trashMessagesSchema.parse(request.body);
    response.json(await services.cleanup.trashMessages(ids));
  });

  app.get("/api/messages/:id", async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const message = await services.archive.parseDetail(id);
    if (!message) return response.status(404).json({ error: "Nachricht nicht gefunden." });
    response.json({
      ...message,
      html: message.html ? cleanEmailHtml(message.html) : null,
    });
  });

  app.get("/api/messages/:id/raw", async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const item = await services.archive.rawPath(id);
    if (!item || !fs.existsSync(item.absolutePath)) {
      return response.status(404).json({ error: "Originalnachricht nicht gefunden." });
    }
    response.type("message/rfc822");
    response.download(item.absolutePath, safeDownloadName(item.filename));
  });

  app.get("/api/messages/:id/attachments/:index", async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const index = z.coerce.number().int().min(0).max(999).parse(request.params.index);
    const attachment = await services.archive.attachment(id, index);
    if (!attachment) return response.status(404).json({ error: "Anhang nicht gefunden." });
    response.type(attachment.contentType);
    response.attachment(safeDownloadName(attachment.filename));
    response.send(attachment.content);
  });

  if (services.production) {
    const clientDirectory = path.resolve("dist/client");
    app.use(express.static(clientDirectory, { index: false, maxAge: "1h" }));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
      response.sendFile(path.join(clientDirectory, "index.html"));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "Nicht gefunden." });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      return response.status(400).json({
        error: "Die Eingaben sind unvollständig oder ungültig.",
        fields: error.flatten().fieldErrors,
      });
    }
    if (error instanceof CleanupRequestError) {
      return response.status(error.status).json({ error: error.message });
    }
    console.error(error);
    response.status(500).json({ error: "Interner Fehler. Details stehen im Serverprotokoll." });
  });

  return app;
}

export function cleanEmailHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [
      "p", "div", "span", "br", "hr", "blockquote", "pre", "code",
      "strong", "b", "em", "i", "u", "s", "del", "sub", "sup",
      "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "a",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, target: "_blank", rel: "noreferrer noopener" },
      }),
    },
  });
}

function numberQuery(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 300) : undefined;
}

function optionalUuid(value: unknown): string | undefined {
  return typeof value === "string" && value ? idSchema.parse(value) : undefined;
}

function safeDownloadName(value: string): string {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 150);
}

export const providerIds: ProviderId[] = ["gmail", "microsoft", "gmx", "webde", "icloud", "custom"];
