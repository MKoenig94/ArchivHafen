import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, X } from "lucide-react";
import type { Account, DashboardStats, SyncJob } from "../shared/types";
import { AccountsView } from "./components/AccountsView";
import { AddAccountModal } from "./components/AddAccountModal";
import { ArchiveView } from "./components/ArchiveView";
import { CleanupRulesView } from "./components/CleanupRulesView";
import { DashboardView } from "./components/DashboardView";
import { SettingsView } from "./components/SettingsView";
import { MobileHeader, Sidebar, type ViewName } from "./components/Sidebar";
import { api } from "./lib/api";

interface ToastState {
  type: "success" | "error";
  message: string;
}

export function App() {
  const [view, setView] = useState<ViewName>("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [reconnectAccount, setReconnectAccount] = useState<Account | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextAccounts, nextDashboard, nextJobs] = await Promise.all([
        api.accounts(), api.dashboard(), api.jobs(),
      ]);
      setAccounts(nextAccounts);
      setDashboard(nextDashboard);
      setJobs(nextJobs);
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Daten konnten nicht geladen werden." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const hasActiveJobs = jobs.some((job) => job.status === "queued" || job.status === "running");
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, hasActiveJobs ? 1_500 : 10_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hasActiveJobs, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeJob = useMemo(
    () => jobs.find((job) => job.status === "running" || job.status === "queued") ?? null,
    [jobs],
  );

  const openAddAccount = () => {
    setReconnectAccount(null);
    setAccountModalOpen(true);
  };

  const openReconnect = (account: Account) => {
    setReconnectAccount(account);
    setAccountModalOpen(true);
  };

  const handleSyncAll = async () => {
    if (!accounts.some((account) => account.connected)) {
      openAddAccount();
      return;
    }
    try {
      const started = await api.syncAll();
      setJobs((current) => [...started, ...current.filter((job) => !started.some((item) => item.id === job.id))]);
      setToast({ type: "success", message: "Archivierung wurde gestartet." });
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Archivierung konnte nicht starten." });
    }
  };

  const viewContent = (() => {
    if (loading) return <AppLoading />;
    switch (view) {
      case "dashboard":
        return <DashboardView
          stats={dashboard}
          accounts={accounts}
          activeJob={activeJob}
          onSync={handleSyncAll}
          onAddAccount={openAddAccount}
          onNavigate={setView}
        />;
      case "archive":
        return <ArchiveView
          accounts={accounts}
          onNotify={(type, message) => setToast({ type, message })}
        />;
      case "accounts":
        return <AccountsView
          accounts={accounts}
          jobs={jobs}
          onAdd={openAddAccount}
          onReconnect={openReconnect}
          onRefresh={refresh}
          onNotify={(type, message) => setToast({ type, message })}
        />;
      case "rules":
        return <CleanupRulesView
          accounts={accounts}
          onNotify={(type, message) => setToast({ type, message })}
        />;
      case "settings":
        return <SettingsView stats={dashboard} />;
    }
  })();

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        accounts={accounts}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNavigate={setView}
        onAddAccount={openAddAccount}
      />
      <div className="app-main">
        <MobileHeader onMenu={() => setSidebarOpen(true)} />
        {activeJob && <SyncStrip job={activeJob} />}
        {viewContent}
      </div>
      {accountModalOpen && (
        <AddAccountModal
          account={reconnectAccount}
          onClose={() => { setAccountModalOpen(false); setReconnectAccount(null); }}
          onCreated={async () => {
            setAccountModalOpen(false);
            await refresh();
            setView("accounts");
            setToast({
              type: "success",
              message: reconnectAccount
                ? "Verbindung erneuert. Die Archivierung läuft."
                : "Postfach verbunden. Die erste Archivierung läuft.",
            });
            setReconnectAccount(null);
          }}
        />
      )}
      {toast && (
        <div className={`toast toast--${toast.type}`} role="status">
          {toast.type === "success" ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Hinweis schließen"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function SyncStrip({ job }: { job: SyncJob }) {
  const progress = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 8;
  return (
    <div className="sync-strip">
      <LoaderCircle className="spin" size={16} />
      <span><strong>{job.accountName ?? "Postfach"}</strong> · {job.phase}</span>
      {job.total > 0 && <small>{job.processed.toLocaleString("de-DE")} / {job.total.toLocaleString("de-DE")}</small>}
      <span className="sync-strip-track"><span style={{ width: `${progress}%` }} /></span>
    </div>
  );
}

function AppLoading() {
  return (
    <main className="page page--loading">
      <div className="loading-brand"><LoaderCircle className="spin" size={24} /> Archiv wird geöffnet …</div>
    </main>
  );
}
