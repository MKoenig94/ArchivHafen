import { useState } from "react";
import {
  Archive,
  Check,
  Clipboard,
  Database,
  ExternalLink,
  FileArchive,
  HardDrive,
  KeyRound,
  LockKeyhole,
  MonitorDot,
  ShieldCheck,
} from "lucide-react";
import type { DashboardStats } from "../../shared/types";
import { formatBytes, formatCount } from "../lib/format";

export function SettingsView({ stats }: { stats: DashboardStats | null }) {
  const [copied, setCopied] = useState(false);
  const dataDirectory = stats?.dataDirectory ?? "–";

  const copyPath = async () => {
    await navigator.clipboard.writeText(dataDirectory);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <main className="page settings-page">
      <header className="page-header">
        <div><div className="eyebrow">System</div><h1>Einstellungen</h1><p className="page-subtitle">Speicher, Sicherheit und Betrieb deines Archivs.</p></div>
      </header>

      <div className="settings-layout">
        <section className="settings-main">
          <div className="settings-section-heading"><div className="settings-icon"><HardDrive size={20} /></div><div><h2>Lokaler Speicher</h2><p>Hier liegen Datenbank, Originalnachrichten und Schlüssel.</p></div></div>
          <div className="settings-card">
            <div className="setting-row setting-row--stacked">
              <div><strong>Datenverzeichnis</strong><span>Standard nach der Linux-XDG-Konvention</span></div>
              <div className="path-field"><code>{dataDirectory}</code><button onClick={copyPath} aria-label="Pfad kopieren">{copied ? <Check size={16} /> : <Clipboard size={16} />}</button></div>
            </div>
            <div className="setting-divider" />
            <div className="setting-row">
              <div><strong>Belegter Platz</strong><span>Summe der archivierten EML-Originale</span></div>
              <span className="setting-value">{formatBytes(stats?.storageBytes ?? 0)}</span>
            </div>
            <div className="setting-divider" />
            <div className="setting-row">
              <div><strong>Archivbestand</strong><span>Nachrichten in {formatCount(stats?.folders ?? 0)} Ordnern</span></div>
              <span className="setting-value">{formatCount(stats?.messages ?? 0)} Mails</span>
            </div>
          </div>

          <div className="settings-section-heading"><div className="settings-icon"><ShieldCheck size={20} /></div><div><h2>Sicherheit</h2><p>Schutzmechanismen für dein privates Archiv.</p></div></div>
          <div className="settings-card security-settings">
            <SecurityRow icon={<KeyRound size={18} />} title="AES-256-GCM" text="Alle IMAP-Passwörter werden authentifiziert verschlüsselt gespeichert." badge="Aktiv" />
            <div className="setting-divider" />
            <SecurityRow icon={<LockKeyhole size={18} />} title="Lokaler Schlüssel" text="Der Master-Schlüssel hat nur Leserechte für deinen Linux-Benutzer." badge="Modus 0600" />
            <div className="setting-divider" />
            <SecurityRow icon={<MonitorDot size={18} />} title="Nur localhost" text="Die Oberfläche lauscht standardmäßig ausschließlich auf 127.0.0.1." badge="Geschützt" />
          </div>

          <div className="settings-section-heading"><div className="settings-icon"><FileArchive size={20} /></div><div><h2>Archivformat</h2><p>Offen, portabel und unabhängig von Archiv Hafen.</p></div></div>
          <div className="format-card">
            <div className="eml-badge">.EML</div>
            <div><strong>Unveränderte RFC-822-Nachrichten</strong><p>Jede E-Mail wird vollständig inklusive Headern und Anhängen abgelegt. Du kannst sie jederzeit mit anderen Mailprogrammen öffnen.</p></div>
          </div>
        </section>

        <aside className="settings-aside">
          <div className="backup-card">
            <div className="backup-icon"><Database size={23} /></div>
            <span className="section-kicker">Empfohlen</span>
            <h2>Archiv regelmäßig sichern</h2>
            <p>Sichere das komplette Datenverzeichnis. Datenbank, EML-Dateien und <code>master.key</code> gehören immer zusammen.</p>
            <ul>
              <li><Check size={15} /> In dein bestehendes Linux-Backup</li>
              <li><Check size={15} /> Verschlüsseltes externes Laufwerk</li>
              <li><Check size={15} /> Snapshots mit Restic oder Borg</li>
            </ul>
          </div>
          <div className="version-card">
            <span className="brand-mark small"><Archive size={16} /></span>
            <div><strong>Archiv Hafen für Linux</strong><span>Version 0.1.0</span></div>
            <span className="local-version">LOCAL</span>
          </div>
        </aside>
      </div>
    </main>
  );
}

function SecurityRow({ icon, title, text, badge }: {
  icon: React.ReactNode;
  title: string;
  text: string;
  badge: string;
}) {
  return (
    <div className="security-row">
      <span>{icon}</span>
      <div><strong>{title}</strong><small>{text}</small></div>
      <em><Check size={12} /> {badge}</em>
    </div>
  );
}
