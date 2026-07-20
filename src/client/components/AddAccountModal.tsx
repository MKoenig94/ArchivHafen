import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Server,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { Account, AccountInput, ProviderId } from "../../shared/types";
import { api } from "../lib/api";

interface ProviderPreset {
  id: ProviderId;
  name: string;
  description: string;
  host: string;
  port: number;
  secure: boolean;
  glyph: string;
  color: string;
  passwordLabel: string;
  hint: string;
}

const providers: ProviderPreset[] = [
  {
    id: "gmail", name: "Google Mail", description: "Gmail & Google Workspace",
    host: "imap.gmail.com", port: 993, secure: true, glyph: "G", color: "#4285f4",
    passwordLabel: "App-Passwort", hint: "Für Google-Konten wird ein 16-stelliges App-Passwort benötigt.",
  },
  {
    id: "microsoft", name: "Microsoft", description: "Outlook & Microsoft 365",
    host: "outlook.office365.com", port: 993, secure: true, glyph: "M", color: "#2563a8",
    passwordLabel: "Passwort / App-Passwort", hint: "Der Server muss die Anmeldung per IMAP-Passwort erlauben.",
  },
  {
    id: "gmx", name: "GMX", description: "GMX FreeMail, ProMail & TopMail",
    host: "imap.gmx.net", port: 993, secure: true, glyph: "G", color: "#1b4f9c",
    passwordLabel: "E-Mail-Passwort", hint: "Aktiviere den IMAP-Zugriff zuvor in deinen GMX-Einstellungen.",
  },
  {
    id: "webde", name: "WEB.DE", description: "FreeMail, Club & Premium",
    host: "imap.web.de", port: 993, secure: true, glyph: "W", color: "#e6a700",
    passwordLabel: "E-Mail-Passwort", hint: "Aktiviere den IMAP-Zugriff zuvor in deinen WEB.DE-Einstellungen.",
  },
  {
    id: "icloud", name: "Apple iCloud", description: "iCloud Mail mit App-Passwort",
    host: "imap.mail.me.com", port: 993, secure: true, glyph: "i", color: "#667085",
    passwordLabel: "App-spezifisches Passwort", hint: "Erstelle bei Apple ein app-spezifisches Passwort für Archiv Hafen.",
  },
  {
    id: "custom", name: "Anderer Anbieter", description: "Eigener IMAP-Server",
    host: "", port: 993, secure: true, glyph: "@", color: "#48705a",
    passwordLabel: "Passwort", hint: "Du findest die IMAP-Daten in der Hilfe deines Mailanbieters.",
  },
];

interface AddAccountModalProps {
  account?: Account | null;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}

export function AddAccountModal({ account, onClose, onCreated }: AddAccountModalProps) {
  const [step, setStep] = useState<"provider" | "credentials" | "verified">(account ? "credentials" : "provider");
  const [providerId, setProviderId] = useState<ProviderId | null>(account?.provider ?? null);
  const [name, setName] = useState(account?.name ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [username, setUsername] = useState(account?.username ?? "");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState(account?.imapHost ?? "");
  const [port, setPort] = useState(account?.imapPort ?? 993);
  const [secure, setSecure] = useState(account?.imapSecure ?? true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderCount, setFolderCount] = useState(0);

  const provider = useMemo(
    () => providers.find((item) => item.id === providerId) ?? null,
    [providerId],
  );

  const selectProvider = (item: ProviderPreset) => {
    setProviderId(item.id);
    setHost(item.host);
    setPort(item.port);
    setSecure(item.secure);
    setStep("credentials");
    setError(null);
  };

  const updateEmail = (value: string) => {
    setEmail(value);
    if (!username || username === email) setUsername(value);
    if (!name) setName(value.split("@")[0]?.replace(/[._-]+/g, " ") ?? "");
  };

  const input = (): AccountInput => ({
    name: name.trim() || email.split("@")[0] || "Postfach",
    email: email.trim(),
    provider: providerId!,
    imapHost: host.trim(),
    imapPort: port,
    imapSecure: secure,
    username: username.trim(),
    password,
    color: account?.color,
  });

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.testAccount(input());
      setFolderCount(result.folders.length);
      setStep("verified");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verbindung konnte nicht geprüft werden.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const savedAccount = account
        ? await api.reconnectAccount(account.id, input())
        : await api.createAccount(input());
      await api.syncAccount(savedAccount.id);
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Postfach konnte nicht gespeichert werden.");
      setStep("credentials");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
        <header className="modal-header">
          <div>
            <span className="modal-step">
              {step === "provider" ? "Schritt 1 von 2" : step === "credentials" ? account ? "Zugang erneuern" : "Schritt 2 von 2" : "Verbindung geprüft"}
            </span>
            <h2 id="account-modal-title">
              {step === "provider" ? "Postfach verbinden" : step === "verified" ? "Alles bereit" : account ? `${account.name} neu verbinden` : provider?.name}
            </h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Dialog schließen"><X size={20} /></button>
        </header>

        {step === "provider" && (
          <div className="modal-body provider-step">
            <p className="modal-intro">Wähle deinen Mailanbieter. Die passenden IMAP-Einstellungen tragen wir automatisch ein.</p>
            <div className="provider-grid">
              {providers.map((item) => (
                <button className="provider-option" key={item.id} onClick={() => selectProvider(item)}>
                  <span className="provider-logo" style={{ color: item.color, backgroundColor: `${item.color}14` }}>{item.glyph}</span>
                  <span><strong>{item.name}</strong><small>{item.description}</small></span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
            <div className="security-note"><ShieldCheck size={18} /><span>Zugangsdaten werden ausschließlich lokal und AES-256-verschlüsselt gespeichert.</span></div>
          </div>
        )}

        {step === "credentials" && provider && (
          <form onSubmit={verify}>
            <div className="modal-body credentials-step">
              {!account && (
                <button type="button" className="back-link" onClick={() => { setStep("provider"); setError(null); }}>
                  <ArrowLeft size={16} /> Anbieter wechseln
                </button>
              )}

              <div className="form-grid two-columns">
                <label className="field">
                  <span>Anzeigename</span>
                  <div className="input-wrap"><Mail size={17} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Privat" required /></div>
                </label>
                <label className="field">
                  <span>E-Mail-Adresse</span>
                  <div className="input-wrap"><Mail size={17} /><input type="email" value={email} onChange={(event) => updateEmail(event.target.value)} placeholder="du@beispiel.de" required autoFocus /></div>
                </label>
              </div>

              <label className="field">
                <span>Benutzername</span>
                <div className="input-wrap"><span className="at-sign">@</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Meist deine E-Mail-Adresse" required /></div>
              </label>

              <label className="field">
                <span>{provider.passwordLabel}</span>
                <div className="input-wrap">
                  <LockKeyhole size={17} />
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••••••" required />
                  <button type="button" className="input-action" onClick={() => setShowPassword((value) => !value)} aria-label="Passwort anzeigen">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <small className="field-hint">{provider.hint}</small>
              </label>

              {provider.id === "custom" && (
                <div className="server-settings">
                  <div className="server-settings-title"><Server size={17} /> IMAP-Server</div>
                  <div className="form-grid server-grid">
                    <label className="field"><span>Host</span><input className="plain-input" value={host} onChange={(event) => setHost(event.target.value)} placeholder="imap.beispiel.de" required /></label>
                    <label className="field"><span>Port</span><input className="plain-input" type="number" min="1" max="65535" value={port} onChange={(event) => setPort(Number(event.target.value))} required /></label>
                  </div>
                  <label className="toggle-row"><input type="checkbox" checked={secure} onChange={(event) => setSecure(event.target.checked)} /><span className="toggle" /><span>Verschlüsselte TLS-Verbindung</span></label>
                </div>
              )}

              {provider.id !== "custom" && (
                <div className="server-summary"><Server size={16} /><span>{host}:{port}</span><span className="secure-chip"><LockKeyhole size={12} /> TLS</span></div>
              )}
              {error && <div className="form-error" role="alert">{error}</div>}
            </div>
            <footer className="modal-footer">
              <span className="footer-security"><LockKeyhole size={14} /> Das Passwort verlässt deinen Rechner nur zum IMAP-Server.</span>
              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? <><span className="button-spinner" /> Verbindung wird geprüft</> : <>Verbindung prüfen <ArrowRight size={17} /></>}
              </button>
            </footer>
          </form>
        )}

        {step === "verified" && provider && (
          <div className="verified-step">
            <div className="verified-orbit"><CheckCircle2 size={42} /></div>
            <span className="success-kicker"><Sparkles size={14} /> Erfolgreich verbunden</span>
            <h3>{email}</h3>
            <p>Archiv Hafen hat <strong>{folderCount} Ordner</strong> gefunden. Die erste Archivierung beginnt direkt nach dem Speichern.</p>
            <div className="verified-list">
              <span><Check size={16} /> TLS-verschlüsselte Verbindung</span>
              <span><Check size={16} /> Zugangsdaten lokal geschützt</span>
              <span><Check size={16} /> Papierkorb und Spam werden ausgelassen</span>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button button--primary button--wide" onClick={save} disabled={busy}>
              {busy ? <><span className="button-spinner" /> Wird eingerichtet</> : <>{account ? "Verbindung erneuern" : "Postfach hinzufügen"} <ArrowRight size={17} /></>}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
