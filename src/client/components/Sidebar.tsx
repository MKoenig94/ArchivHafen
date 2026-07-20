import {
  Archive,
  Boxes,
  HardDrive,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Menu,
  Plus,
  Settings,
  X,
} from "lucide-react";
import type { Account } from "../../shared/types";
import { initials } from "../lib/format";

export type ViewName = "dashboard" | "archive" | "accounts" | "rules" | "settings";

interface SidebarProps {
  view: ViewName;
  accounts: Account[];
  open: boolean;
  onClose: () => void;
  onNavigate: (view: ViewName) => void;
  onAddAccount: () => void;
}

const navigation = [
  { id: "dashboard" as const, label: "Übersicht", icon: LayoutDashboard },
  { id: "archive" as const, label: "Archiv", icon: Inbox },
  { id: "accounts" as const, label: "Postfächer", icon: Boxes },
  { id: "rules" as const, label: "Regeln", icon: ListChecks },
];

export function Sidebar({
  view, accounts, open, onClose, onNavigate, onAddAccount,
}: SidebarProps) {
  const navigate = (next: ViewName) => {
    onNavigate(next);
    onClose();
  };

  return (
    <>
      {open && <button className="sidebar-scrim" aria-label="Menü schließen" onClick={onClose} />}
      <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><Archive size={20} strokeWidth={2.2} /></div>
          <div className="brand-name">Archiv Hafen</div>
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Menü schließen">
            <X size={20} />
          </button>
        </div>

        <nav className="main-nav" aria-label="Hauptnavigation">
          <div className="nav-label">Arbeitsbereich</div>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "nav-item--active" : ""}`}
                onClick={() => navigate(item.id)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {item.id === "archive" && accounts.reduce((sum, account) => sum + account.messageCount, 0) > 0 && (
                  <span className="nav-count">
                    {accounts.reduce((sum, account) => sum + account.messageCount, 0).toLocaleString("de-DE")}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-accounts">
          <div className="nav-label nav-label--row">
            <span>Postfächer</span>
            <button className="mini-add" onClick={onAddAccount} aria-label="Postfach hinzufügen">
              <Plus size={15} />
            </button>
          </div>
          <div className="account-mini-list">
            {accounts.filter((account) => account.connected).map((account) => (
              <button key={account.id} className="account-mini" onClick={() => navigate("accounts")}>
                <span className="account-avatar" style={{ backgroundColor: account.color }}>
                  {initials(account.name)}
                </span>
                <span className="account-mini-copy">
                  <strong>{account.name}</strong>
                  <small>{account.email}</small>
                </span>
                <span className={`status-dot status-dot--${account.status}`} />
              </button>
            ))}
            {!accounts.some((account) => account.connected) && (
              <button className="empty-account-link" onClick={onAddAccount}>
                <Plus size={16} /> Erstes Postfach verbinden
              </button>
            )}
          </div>
        </div>

        <button
          className={`nav-item nav-settings ${view === "settings" ? "nav-item--active" : ""}`}
          onClick={() => navigate("settings")}
        >
          <Settings size={19} />
          <span>Einstellungen</span>
        </button>

        <div className="local-badge">
          <HardDrive size={17} />
          <div><strong>100 % lokal</strong><span>Deine Daten bleiben bei dir</span></div>
        </div>
      </aside>
    </>
  );
}

export function MobileHeader({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="mobile-header">
      <button className="icon-button" onClick={onMenu} aria-label="Menü öffnen"><Menu size={21} /></button>
      <div className="mobile-brand"><Archive size={18} /> Archiv Hafen</div>
      <span className="mobile-spacer" />
    </header>
  );
}
