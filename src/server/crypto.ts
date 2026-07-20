import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION = "v1";

export class CredentialVault {
  private readonly key: Buffer;

  constructor(
    dataDirectory: string,
    configuredSecret = process.env.ARCHIVHAFEN_MASTER_KEY ?? process.env.MAILSTORE_MASTER_KEY,
  ) {
    this.key = configuredSecret
      ? createHash("sha256").update(configuredSecret, "utf8").digest()
      : loadOrCreateKey(dataDirectory);
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, encrypted].map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    ).join(".");
  }

  decrypt(payload: string): string {
    const [version, ivValue, tagValue, encryptedValue] = payload.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
      throw new Error("Ungültiges Format der verschlüsselten Zugangsdaten.");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

function loadOrCreateKey(dataDirectory: string): Buffer {
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dataDirectory, "master.key");

  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length !== 32) {
      throw new Error(`Der Schlüssel ${keyPath} hat eine ungültige Länge.`);
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  try {
    fs.writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return fs.readFileSync(keyPath);
    }
    throw error;
  }
}
