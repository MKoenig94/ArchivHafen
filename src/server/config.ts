import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(path.resolve(".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

function defaultDataDirectory(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg ?? path.join(os.homedir(), ".local", "share");
  const preferred = path.join(base, "archivhafen");
  const legacy = path.join(base, "mailstore");
  return fs.existsSync(preferred) || !fs.existsSync(legacy) ? preferred : legacy;
}

function environmentValue(currentName: string, legacyName: string): string | undefined {
  return process.env[currentName] ?? process.env[legacyName];
}

export function resolveDatabasePath(dataDirectory: string): string {
  const preferred = path.join(dataDirectory, "archivhafen.sqlite");
  const legacy = path.join(dataDirectory, "mailstore.sqlite");
  return fs.existsSync(preferred) || !fs.existsSync(legacy) ? preferred : legacy;
}

export const config = {
  host: environmentValue("ARCHIVHAFEN_HOST", "MAILSTORE_HOST") ?? "127.0.0.1",
  port: Number.parseInt(environmentValue("ARCHIVHAFEN_PORT", "MAILSTORE_PORT") ?? "4174", 10),
  dataDirectory: path.resolve(
    environmentValue("ARCHIVHAFEN_DATA_DIR", "MAILSTORE_DATA_DIR") ?? defaultDataDirectory(),
  ),
  isProduction: process.env.NODE_ENV === "production",
  syncIntervalMinutes: Math.max(
    0,
    Number.parseInt(
      environmentValue("ARCHIVHAFEN_SYNC_INTERVAL_MINUTES", "MAILSTORE_SYNC_INTERVAL_MINUTES") ?? "15",
      10,
    ) || 0,
  ),
};
