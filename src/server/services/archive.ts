import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { MessageAddress, MessageDetail } from "../../shared/types.js";
import type { StoreDatabase } from "../database.js";

export interface RawMessageInput {
  accountId: string;
  folderId: string;
  uidValidity: string;
  imapUid: number;
  source: Buffer;
  flags?: Iterable<string>;
  internalDate?: Date | string;
}

export class ArchiveService {
  constructor(
    private readonly dataDirectory: string,
    private readonly database: StoreDatabase,
  ) {}

  async archive(input: RawMessageInput): Promise<{ id: string; inserted: boolean }> {
    const hash = createHash("sha256").update(input.source).digest("hex");
    const parsed = await simpleParser(input.source, {
      skipImageLinks: true,
      skipTextLinks: true,
    });
    const messageDate = parsed.date ?? toDate(input.internalDate) ?? new Date();
    const relativePath = path.join(
      "archive",
      input.accountId,
      String(messageDate.getUTCFullYear()),
      String(messageDate.getUTCMonth() + 1).padStart(2, "0"),
      `${hash}.eml`,
    );
    const absolutePath = path.join(this.dataDirectory, relativePath);
    await writeOnce(absolutePath, input.source);

    const sender = firstAddress(parsed.from) ?? { name: "Unbekannt", address: "" };
    const recipients = addresses(parsed.to);
    const cc = addresses(parsed.cc);
    const text = normalizeText(parsed.text ?? (typeof parsed.html === "string" ? parsed.html : ""));
    const messageId = cleanMessageId(parsed.messageId);

    return this.database.archiveMessage({
      id: randomUUID(),
      accountId: input.accountId,
      folderId: input.folderId,
      uidValidity: input.uidValidity,
      imapUid: input.imapUid,
      messageId,
      subject: parsed.subject?.trim() || "(Kein Betreff)",
      sender,
      recipients,
      cc,
      sentAt: parsed.date?.toISOString() ?? null,
      receivedAt: toDate(input.internalDate)?.toISOString() ?? null,
      preview: text.slice(0, 260),
      searchBody: text,
      flags: [...(input.flags ?? [])],
      size: input.source.byteLength,
      rawPath: relativePath,
      contentHash: hash,
      hasAttachments: parsed.attachments.length > 0,
      attachmentCount: parsed.attachments.length,
    });
  }

  async parseDetail(messageId: string): Promise<MessageDetail | null> {
    const record = this.database.getMessage(messageId);
    if (!record) return null;
    const parsed = await this.readParsed(record.rawPath);
    return {
      ...record,
      text: parsed.text ?? "",
      html: typeof parsed.html === "string" ? parsed.html : null,
      attachments: parsed.attachments.map((attachment, index) => ({
        index,
        filename: attachment.filename || `Anhang-${index + 1}`,
        contentType: attachment.contentType || "application/octet-stream",
        size: attachment.size,
        contentId: attachment.contentId ?? null,
      })),
    };
  }

  async rawPath(messageId: string): Promise<{ absolutePath: string; filename: string } | null> {
    const record = this.database.getMessage(messageId);
    if (!record) return null;
    return {
      absolutePath: this.resolveArchivePath(record.rawPath),
      filename: emlFilename(record.subject),
    };
  }

  async attachment(messageId: string, index: number): Promise<{
    content: Buffer;
    filename: string;
    contentType: string;
  } | null> {
    const record = this.database.getMessage(messageId);
    if (!record) return null;
    const parsed = await this.readParsed(record.rawPath);
    const attachment = parsed.attachments[index];
    if (!attachment) return null;
    return {
      content: attachment.content,
      filename: attachment.filename || `Anhang-${index + 1}`,
      contentType: attachment.contentType || "application/octet-stream",
    };
  }

  private async readParsed(relativePath: string): Promise<ParsedMail> {
    const source = await fs.readFile(this.resolveArchivePath(relativePath));
    return simpleParser(source, { skipImageLinks: true, skipTextLinks: true });
  }

  private resolveArchivePath(relativePath: string): string {
    const root = path.resolve(this.dataDirectory, "archive");
    const resolved = path.resolve(this.dataDirectory, relativePath);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("Ungültiger Archivpfad.");
    }
    return resolved;
  }
}

async function writeOnce(target: string, content: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const handle = await fs.open(target, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function addresses(value?: AddressObject | AddressObject[] | null): MessageAddress[] {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.flatMap((entry) => entry.value ?? []).map((address) => ({
    name: address.name?.trim() || address.address || "Unbekannt",
    address: address.address ?? "",
  }));
}

function firstAddress(value?: AddressObject | AddressObject[] | null): MessageAddress | null {
  return addresses(value)[0] ?? null;
}

function normalizeText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toDate(value?: Date | string): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanMessageId(value?: string): string | null {
  const cleaned = value?.trim();
  return cleaned || null;
}

function emlFilename(subject: string): string {
  const safe = subject
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "nachricht";
  return `${safe}.eml`;
}
