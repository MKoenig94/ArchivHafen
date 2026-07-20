import { config, resolveDatabasePath } from "../src/server/config.js";
import { CredentialVault } from "../src/server/crypto.js";
import { StoreDatabase } from "../src/server/database.js";
import { ArchiveService } from "../src/server/services/archive.js";

const database = new StoreDatabase(resolveDatabasePath(config.dataDirectory));
const existing = database.getStats(config.dataDirectory);
if (existing.messages > 0 || existing.accounts > 0) {
  console.error(`Abbruch: ${config.dataDirectory} enthält bereits Archivdaten.`);
  database.close();
  process.exit(1);
}

const vault = new CredentialVault(config.dataDirectory);
const archive = new ArchiveService(config.dataDirectory, database);
const account = database.createAccount({
  name: "Privat",
  email: "marie@beispiel.de",
  provider: "custom",
  imapHost: "imap.beispiel.de",
  imapPort: 993,
  imapSecure: true,
  username: "marie@beispiel.de",
  password: "demo",
  color: "#356a4b",
}, vault.encrypt("demo"));
const inbox = database.upsertFolder({ accountId: account.id, path: "INBOX", name: "Posteingang", specialUse: "\\Inbox" });
const sent = database.upsertFolder({ accountId: account.id, path: "Gesendet", name: "Gesendet", specialUse: "\\Sent" });
const projects = database.upsertFolder({ accountId: account.id, path: "Projekte", name: "Projekte", specialUse: null });

const messages = [
  { uid: 1, folder: inbox.id, from: "Anna Schubert <anna@studio-nord.de>", to: "Marie <marie@beispiel.de>", subject: "Entwürfe für die neue Website", date: "2026-07-20T08:34:00+02:00", body: "Hallo Marie, anbei findest du die drei überarbeiteten Entwürfe. Die mobile Ansicht ist jetzt ebenfalls fertig.", attachment: "entwurf-v3.pdf" },
  { uid: 2, folder: inbox.id, from: "Jonas Keller <jonas@freiraum.io>", to: "Marie <marie@beispiel.de>", subject: "Termin am Donnerstag", date: "2026-07-19T16:12:00+02:00", body: "Passt dir Donnerstag um 14 Uhr? Ich würde gern die nächsten Schritte für das Projekt besprechen." },
  { uid: 3, folder: projects.id, from: "Buchhaltung <rechnung@office.example>", to: "Marie <marie@beispiel.de>", subject: "Rechnung 2026-0719", date: "2026-07-19T10:06:00+02:00", body: "Guten Tag, im Anhang übersenden wir die aktuelle Rechnung. Vielen Dank für die Zusammenarbeit.", attachment: "rechnung-2026-0719.pdf" },
  { uid: 4, folder: inbox.id, from: "Linux Weekly <digest@linuxweekly.example>", to: "Marie <marie@beispiel.de>", subject: "Kernel, Container und kleine Werkzeuge", date: "2026-07-18T07:40:00+02:00", body: "Diese Woche: ein Blick auf den neuen Scheduler, sichere Container und fünf praktische Kommandozeilenwerkzeuge." },
  { uid: 5, folder: sent.id, from: "Marie <marie@beispiel.de>", to: "Anna Schubert <anna@studio-nord.de>", subject: "Re: Entwürfe für die neue Website", date: "2026-07-17T15:22:00+02:00", body: "Danke Anna, die Richtung gefällt mir sehr gut. Lass uns bei Variante zwei weiterarbeiten." },
  { uid: 6, folder: projects.id, from: "Mila Nguyen <mila@atelier.example>", to: "Marie <marie@beispiel.de>", subject: "Notizen vom Workshop", date: "2026-07-15T13:18:00+02:00", body: "Hier ist die Zusammenfassung unseres Workshops mit Entscheidungen, offenen Punkten und Verantwortlichkeiten.", attachment: "workshop-notizen.txt" },
  { uid: 7, folder: inbox.id, from: "Git Forge <notifications@git.example>", to: "Marie <marie@beispiel.de>", subject: "Merge Request wurde freigegeben", date: "2026-07-14T18:55:00+02:00", body: "Der Merge Request Archivsuche wurde von zwei Personen geprüft und ist bereit zum Zusammenführen." },
  { uid: 8, folder: inbox.id, from: "Clara Roth <clara@beispiel.de>", to: "Marie <marie@beispiel.de>", subject: "Fotos vom Wochenende", date: "2026-07-12T20:03:00+02:00", body: "Das war ein schöner Ausflug. Ich habe dir eine kleine Auswahl der Fotos angehängt.", attachment: "auswahl.jpg" },
];

for (const item of messages) {
  await archive.archive({
    accountId: account.id,
    folderId: item.folder,
    uidValidity: "20260720",
    imapUid: item.uid,
    source: demoMessage(item),
    flags: item.folder === inbox.id && item.uid < 3 ? [] : ["\\Seen"],
    internalDate: item.date,
  });
}

database.setAccountSyncState(account.id, { status: "ready", completed: true });
database.close();
console.log(`Demoarchiv mit ${messages.length} Nachrichten erstellt: ${config.dataDirectory}`);

function demoMessage(item: typeof messages[number]): Buffer {
  const boundary = `archivhafen-demo-${item.uid}`;
  const common = [
    `From: ${item.from}`,
    `To: ${item.to}`,
    `Date: ${new Date(item.date).toUTCString()}`,
    `Message-ID: <demo-${item.uid}@archivhafen.local>`,
    `Subject: ${item.subject}`,
    "MIME-Version: 1.0",
  ];
  if (!item.attachment) {
    return Buffer.from([...common, "Content-Type: text/plain; charset=utf-8", "", item.body, ""].join("\r\n"));
  }
  return Buffer.from([
    ...common,
    `Content-Type: multipart/mixed; boundary=${boundary}`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    item.body,
    `--${boundary}`,
    `Content-Type: application/octet-stream; name=${item.attachment}`,
    `Content-Disposition: attachment; filename=${item.attachment}`,
    "Content-Transfer-Encoding: base64",
    "",
    "RGVtby1Bbmhhbmc=",
    `--${boundary}--`,
    "",
  ].join("\r\n"));
}
