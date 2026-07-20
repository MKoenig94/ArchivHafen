import { useMemo, useState } from "react";
import {
  Archive,
  CircleAlert,
  Clock3,
  KeyRound,
  Link2Off,
  LoaderCircle,
  Mail,
  MoreVertical,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { Account, SyncJob } from "../../shared/types";
import { api } from "../lib/api";
import { formatCount, relativeTime } from "../lib/format";

interface AccountsViewProps {
  accounts: Account[];
  jobs: SyncJob[];
  onAdd: () => void;
  onReconnect: (account: Account) => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: "success" | "error", message: string) => void;
}

export function AccountsView({ accounts, jobs, onAdd, onReconnect, onRefresh, onNotify }: AccountsViewProps) {
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const connected = accounts.filter((account) => account.connected);
  const disconnected = accounts.filter((account) => !account.connected);
  const activeJobs = useMemo(() => new Map(
    jobs
      .filter((job) => job.accountId && (job.status === "running" || job.status === "queued"))
      .map((job) => [job.accountId!, job]),
  ), [jobs]);

  const sync = async (account: Account) => {
    setBusyAccount(account.id);
    try {
      await api.syncAccount(account.id);
      onNotify("success", `${account.name} wird archiviert.`);
      await onRefresh();
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Synchronisierung konnte nicht starten.");
    } finally {
      setBusyAccount(null);
    }
  };

  const disconnect = async (account: Account) => {
    const approved = window.confirm(
      `Verbindung zu „${account.name}“ trennen?\n\nBereits archivierte Nachrichten bleiben vollständig erhalten. Das gespeicherte Passwort wird gelöscht.`,
    );
    if (!approved) return;
    setBusyAccount(account.id);
    try {
      await api.disconnectAccount(account.id);
      onNotify("success", "Postfach getrennt. Das Archiv bleibt erhalten.");
      await onRefresh();
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Postfach konnte nicht getrennt werden.");
    } finally {
      setBusyAccount(null);
    }
  };

  return (
    <main className="page accounts-page">
      <header className="page-header">
        <div><div className="eyebrow">Verbindungen</div><h1>Postfächer</h1><p className="page-subtitle">Verwalte alle Quellen deines lokalen Archivs.</p></div>
        <button className="button button--primary" onClick={onAdd}><Plus size={18} /> Postfach verbinden</button>
      </header>

      {connected.length === 0 ? (
        <section className="empty-state-card">
          <div className="empty-state-icon"><Mail size={30} /></div>
          <h2>Noch kein Postfach verbunden</h2>
          <p>Archiv Hafen unterstützt jeden Anbieter mit IMAP-Zugang – von Gmail bis zum eigenen Mailserver.</p>
          <button className="button button--primary" onClick={onAdd}><Plus size={18} /> Erstes Postfach verbinden</button>
        </section>
      ) : (
        <section className="accounts-grid">
          {connected.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              job={activeJobs.get(account.id)}
              busy={busyAccount === account.id}
              onSync={() => sync(account)}
              onReconnect={() => onReconnect(account)}
              onDisconnect={() => disconnect(account)}
            />
          ))}
          <button className="add-account-card" onClick={onAdd}>
            <span><Plus size={23} /></span>
            <strong>Weiteres Postfach</strong>
            <small>IMAP-Verbindung hinzufügen</small>
          </button>
        </section>
      )}

      <section className="accounts-info-grid">
        <article className="info-panel">
          <div className="info-panel-icon"><ShieldCheck size={21} /></div>
          <div><strong>Zugangsdaten geschützt</strong><p>Passwörter werden mit AES-256-GCM verschlüsselt und nur auf diesem Gerät gespeichert.</p></div>
        </article>
        <article className="info-panel">
          <div className="info-panel-icon"><Archive size={21} /></div>
          <div><strong>Archiv bleibt unabhängig</strong><p>Auch nach dem Trennen eines Postfachs bleiben alle EML-Originale und Suchdaten erhalten.</p></div>
        </article>
      </section>

      {disconnected.length > 0 && (
        <section className="disconnected-section">
          <div className="section-heading"><div><span className="section-kicker">Historie</span><h2>Getrennte Postfächer</h2></div></div>
          {disconnected.map((account) => (
            <div className="disconnected-row" key={account.id}>
              <span className="account-large-avatar account-large-avatar--muted"><Link2Off size={19} /></span>
              <div><strong>{account.name}</strong><small>{account.email}</small></div>
              <span>{formatCount(account.messageCount)} archivierte Mails</span>
              <button className="text-button" onClick={() => onReconnect(account)}>Neu verbinden</button>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function AccountCard({ account, job, busy, onSync, onReconnect, onDisconnect }: {
  account: Account;
  job?: SyncJob;
  busy: boolean;
  onSync: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = Boolean(job);
  const progress = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <article className={`account-card ${account.status === "error" ? "account-card--error" : ""}`}>
      <div className="account-card-top">
        <span className="account-large-avatar" style={{ backgroundColor: account.color }}>
          {providerGlyph(account.provider)}
        </span>
        <div className="account-card-title"><h2>{account.name}</h2><p>{account.email}</p></div>
        <div className="account-menu-wrap">
          <button className="icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Postfachoptionen"><MoreVertical size={19} /></button>
          {menuOpen && (
            <div className="account-menu">
              <button className="menu-normal" onClick={() => { setMenuOpen(false); onReconnect(); }}><KeyRound size={16} /> Zugangsdaten erneuern</button>
              <button className="menu-danger" onClick={() => { setMenuOpen(false); onDisconnect(); }}><Link2Off size={16} /> Verbindung trennen</button>
            </div>
          )}
        </div>
      </div>

      {account.status === "error" && (
        <div className="account-error"><CircleAlert size={16} /><span>{account.lastError ?? "Synchronisierung fehlgeschlagen."}</span></div>
      )}

      <div className="account-metrics">
        <div><span>Archiviert</span><strong>{formatCount(account.messageCount)} <small>Mails</small></strong></div>
        <div><span>Letzter Lauf</span><strong className="metric-small">{relativeTime(account.lastSyncAt)}</strong></div>
      </div>

      <div className="account-server"><Server size={15} /><span>{account.imapHost}:{account.imapPort}</span><span className="server-lock"><KeyRound size={12} /> TLS</span></div>

      {active && job ? (
        <div className="card-progress">
          <div><span><LoaderCircle size={15} className="spin" /> {job.phase}</span><strong>{job.total ? `${progress}%` : "…"}</strong></div>
          <div className="progress-track"><span style={{ width: `${job.total ? progress : 8}%` }} /></div>
        </div>
      ) : (
        <button className="button button--secondary button--card" onClick={onSync} disabled={busy}>
          <RefreshCw size={16} className={busy ? "spin" : ""} /> Jetzt synchronisieren
        </button>
      )}
    </article>
  );
}

function providerGlyph(provider: Account["provider"]): string {
  return ({ gmail: "G", microsoft: "M", gmx: "G", webde: "W", icloud: "i", custom: "@" })[provider];
}
