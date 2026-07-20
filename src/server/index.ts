import fs from "node:fs";
import { createApp } from "./app.js";
import { config, resolveDatabasePath } from "./config.js";
import { CredentialVault } from "./crypto.js";
import { StoreDatabase } from "./database.js";
import { ArchiveService } from "./services/archive.js";
import { SyncManager } from "./services/imap.js";

fs.mkdirSync(config.dataDirectory, { recursive: true, mode: 0o700 });
const database = new StoreDatabase(resolveDatabasePath(config.dataDirectory));
const vault = new CredentialVault(config.dataDirectory);
const archive = new ArchiveService(config.dataDirectory, database);
const sync = new SyncManager(database, vault, archive);
const app = createApp({
  database,
  vault,
  archive,
  sync,
  dataDirectory: config.dataDirectory,
  production: config.isProduction,
});

let syncTimer: NodeJS.Timeout | null = null;
const server = app.listen(config.port, config.host, (error?: Error) => {
  if (error) {
    console.error(`Archiv Hafen konnte nicht gestartet werden: ${error.message}`);
    database.close();
    process.exitCode = 1;
    return;
  }
  console.log(`Archiv Hafen läuft auf http://${config.host}:${config.port}`);
  console.log(`Archiv: ${config.dataDirectory}`);
  if (config.syncIntervalMinutes > 0) {
    console.log(`Automatische Archivierung: alle ${config.syncIntervalMinutes} Minuten`);
    syncTimer = setInterval(() => sync.startAll(), config.syncIntervalMinutes * 60_000);
  }
});

function shutdown(): void {
  if (syncTimer) clearInterval(syncTimer);
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
