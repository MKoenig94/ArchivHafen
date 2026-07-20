import {
  Archive,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  CloudDownload,
  Database,
  FolderOpen,
  Inbox,
  MailCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { Account, DashboardStats, SyncJob } from "../../shared/types";
import { formatBytes, formatCount, formatMessageDate, relativeTime } from "../lib/format";
import type { ViewName } from "./Sidebar";

interface DashboardProps {
  stats: DashboardStats | null;
  accounts: Account[];
  activeJob: SyncJob | null;
  onSync: () => void;
  onAddAccount: () => void;
  onNavigate: (view: ViewName) => void;
}

export function DashboardView({
  stats, accounts, activeJob, onSync, onAddAccount, onNavigate,
}: DashboardProps) {
  const connected = accounts.filter((account) => account.connected);
  const empty = connected.length === 0;

  return (
    <main className="page dashboard-page">
      <header className="page-header dashboard-header">
        <div>
          <div className="eyebrow">{greeting()}</div>
          <h1>Dein Mailarchiv</h1>
          <p className="page-subtitle">
            {empty
              ? "Sichere deine E-Mails dauerhaft und unabhängig vom Anbieter."
              : `Zuletzt aktualisiert ${relativeTime(stats?.lastSyncAt ?? null)}.`}
          </p>
        </div>
        <button className="button button--primary sync-button" onClick={onSync} disabled={Boolean(activeJob)}>
          <RefreshCw size={18} className={activeJob ? "spin" : ""} />
          {activeJob ? "Archivierung läuft" : "Jetzt archivieren"}
        </button>
      </header>

      {empty ? (
        <WelcomePanel onAddAccount={onAddAccount} />
      ) : (
        <>
          <section className="stats-grid" aria-label="Archivstatistik">
            <StatCard
              icon={<Inbox size={20} />}
              tone="green"
              value={formatCount(stats?.messages ?? 0)}
              label="Archivierte Mails"
              hint="Volltextdurchsuchbar"
            />
            <StatCard
              icon={<Database size={20} />}
              tone="blue"
              value={formatBytes(stats?.storageBytes ?? 0)}
              label="Archivgröße"
              hint="Originale im EML-Format"
            />
            <StatCard
              icon={<FolderOpen size={20} />}
              tone="amber"
              value={formatCount(stats?.folders ?? 0)}
              label="Ordner"
              hint={`Aus ${connected.length} ${connected.length === 1 ? "Postfach" : "Postfächern"}`}
            />
            <StatCard
              icon={<ShieldCheck size={20} />}
              tone="violet"
              value="Lokal"
              label="Speicherort"
              hint="Keine fremde Cloud"
            />
          </section>

          <div className="dashboard-columns">
            <section className="panel recent-panel">
              <div className="panel-header">
                <div><span className="section-kicker">Neu im Archiv</span><h2>Letzte Nachrichten</h2></div>
                <button className="text-button" onClick={() => onNavigate("archive")}>Alle anzeigen <ArrowRight size={16} /></button>
              </div>
              {stats?.recentMessages.length ? (
                <div className="recent-list">
                  {stats.recentMessages.map((message) => (
                    <button className="recent-row" key={message.id} onClick={() => onNavigate("archive")}>
                      <span className="sender-avatar" style={{ backgroundColor: `${message.accountColor}18`, color: message.accountColor }}>
                        {message.sender.name.slice(0, 1).toUpperCase() || "?"}
                      </span>
                      <span className="recent-copy">
                        <span className="recent-meta"><strong>{message.sender.name}</strong><small>{formatMessageDate(message.sentAt ?? message.receivedAt)}</small></span>
                        <span className="recent-subject">{message.subject}</span>
                        <span className="recent-preview">{message.preview}</span>
                      </span>
                      <ChevronRight size={18} className="row-chevron" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="panel-empty"><MailCheck size={24} /><p>Beim nächsten Lauf erscheinen neue Nachrichten hier.</p></div>
              )}
            </section>

            <aside className="dashboard-side">
              <section className="panel account-status-panel">
                <div className="panel-header compact"><div><span className="section-kicker">Verbindungen</span><h2>Postfächer</h2></div></div>
                <div className="dashboard-account-list">
                  {connected.map((account) => (
                    <div className="dashboard-account" key={account.id}>
                      <span className="provider-glyph" style={{ backgroundColor: `${account.color}18`, color: account.color }}>
                        {account.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div><strong>{account.name}</strong><small>{formatCount(account.messageCount)} Mails</small></div>
                      <span className={`connection-pill connection-pill--${account.status}`}>
                        {account.status === "error" ? "Fehler" : account.status === "syncing" ? "Läuft" : "Bereit"}
                      </span>
                    </div>
                  ))}
                </div>
                <button className="add-inline" onClick={onAddAccount}><Plus size={17} /> Weiteres Postfach</button>
              </section>

              <section className="privacy-card">
                <div className="privacy-icon"><ShieldCheck size={22} /></div>
                <div>
                  <strong>Privat by design</strong>
                  <p>Passwörter sind verschlüsselt. Externe Bilder in E-Mails bleiben blockiert.</p>
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

function WelcomePanel({ onAddAccount }: { onAddAccount: () => void }) {
  return (
    <section className="welcome-panel">
      <div className="welcome-copy">
        <span className="welcome-tag"><ShieldCheck size={14} /> Lokal & privat</span>
        <h2>Deine Mails.<br />Dein Archiv.</h2>
        <p>Verbinde dein erstes Postfach. Archiv Hafen lädt alle Nachrichten unverändert herunter und macht sie blitzschnell durchsuchbar.</p>
        <button className="button button--light" onClick={onAddAccount}>
          <Plus size={18} /> Postfach verbinden
        </button>
        <div className="welcome-points">
          <span><Check size={15} /> IMAP-kompatibel</span>
          <span><Check size={15} /> Kein Cloud-Zwang</span>
          <span><Check size={15} /> Offenes EML-Format</span>
        </div>
      </div>
      <div className="archive-illustration" aria-hidden="true">
        <div className="mail-card mail-card--back"><span /><span /><span /></div>
        <div className="mail-card mail-card--middle"><span /><span /><span /></div>
        <div className="mail-card mail-card--front">
          <div className="mail-card-icon"><CloudDownload size={26} /></div>
          <span /><span /><span />
        </div>
        <div className="archive-box"><Archive size={44} /><span>Sicher archiviert</span></div>
      </div>
    </section>
  );
}

function StatCard({
  icon, tone, value, label, hint,
}: { icon: React.ReactNode; tone: string; value: string; label: string; hint: string }) {
  return (
    <article className="stat-card">
      <span className={`stat-icon stat-icon--${tone}`}>{icon}</span>
      <div className="stat-copy"><strong>{value}</strong><span>{label}</span><small>{hint}</small></div>
    </article>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}
