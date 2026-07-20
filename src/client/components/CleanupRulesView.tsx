import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  CalendarClock,
  Eye,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  Account,
  CleanupConditionType,
  CleanupPreview,
  CleanupRule,
  CleanupRuleInput,
} from "../../shared/types";
import { api } from "../lib/api";
import { formatCount, formatDate } from "../lib/format";

export function CleanupRulesView({ accounts, onNotify }: {
  accounts: Account[];
  onNotify: (type: "success" | "error", message: string) => void;
}) {
  const connectedAccounts = useMemo(() => accounts.filter((account) => account.connected), [accounts]);
  const [rules, setRules] = useState<CleanupRule[]>([]);
  const [accountId, setAccountId] = useState(connectedAccounts[0]?.id ?? "");
  const [conditionType, setConditionType] = useState<CleanupConditionType>("older_than");
  const [olderThanDays, setOlderThanDays] = useState(365);
  const [sender, setSender] = useState("");
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setRules(await api.cleanupRules());
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Regeln konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!accountId && connectedAccounts[0]) setAccountId(connectedAccounts[0].id);
  }, [accountId, connectedAccounts]);
  useEffect(() => { setPreview(null); }, [accountId, conditionType, olderThanDays, sender]);

  const input = (): CleanupRuleInput => conditionType === "older_than"
    ? { accountId, conditionType, olderThanDays, enabled: true }
    : { accountId, conditionType, sender: sender.trim().toLowerCase(), enabled: true };

  const previewRule = async (): Promise<CleanupPreview | null> => {
    if (!accountId) {
      onNotify("error", "Wähle zuerst ein verbundenes Postfach aus.");
      return null;
    }
    setPreviewing(true);
    try {
      const result = await api.previewCleanupRule(input());
      setPreview(result);
      return result;
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Vorschau konnte nicht erstellt werden.");
      return null;
    } finally {
      setPreviewing(false);
    }
  };

  const createRule = async () => {
    if (!preview) {
      onNotify("error", "Prüfe die Regel zuerst mit der Vorschau.");
      return;
    }
    if (!window.confirm(
      `Regel aktivieren?\n\nAktuell passen ${preview.count.toLocaleString("de-DE")} Nachrichten. Nach jeder erfolgreichen Archivierung werden passende Nachrichten im Postfach in den Papierkorb verschoben. Die lokalen Archivkopien bleiben erhalten.`,
    )) return;
    setSaving(true);
    try {
      await api.createCleanupRule(input());
      setPreview(null);
      await refresh();
      onNotify("success", "Bereinigungsregel wurde aktiviert. Sie läuft nach der nächsten Archivierung.");
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Regel konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const runRule = async (rule: CleanupRule) => {
    setRunningId(rule.id);
    try {
      const currentPreview = await api.previewCleanupRule(toInput(rule));
      if (!currentPreview.count) {
        onNotify("success", "Für diese Regel gibt es aktuell keine passenden Nachrichten.");
        return;
      }
      if (!window.confirm(
        `${currentPreview.count.toLocaleString("de-DE")} passende Nachrichten jetzt im Postfach in den Papierkorb verschieben?\n\nDie lokalen Archivkopien bleiben erhalten.`,
      )) return;
      const result = await api.runCleanupRule(rule.id);
      await refresh();
      if (result.failed.length) {
        onNotify("error", `${result.moved} verschoben, ${result.failed.length} fehlgeschlagen: ${result.failed[0].error}`);
      } else {
        onNotify("success", `${result.moved} Nachrichten wurden in den Papierkorb verschoben.`);
      }
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Regel konnte nicht ausgeführt werden.");
    } finally {
      setRunningId(null);
    }
  };

  const toggleRule = async (rule: CleanupRule) => {
    setRunningId(rule.id);
    try {
      if (!rule.enabled) {
        const currentPreview = await api.previewCleanupRule(toInput(rule));
        if (!window.confirm(
          `Regel wieder aktivieren?\n\nAktuell passen ${currentPreview.count.toLocaleString("de-DE")} Nachrichten. Nach der nächsten erfolgreichen Archivierung werden Treffer im Postfach in den Papierkorb verschoben. Die lokalen Archivkopien bleiben erhalten.`,
        )) return;
      }
      const updated = await api.setCleanupRuleEnabled(rule.id, !rule.enabled);
      setRules((current) => current.map((item) => item.id === updated.id ? updated : item));
      onNotify("success", updated.enabled ? "Regel wurde aktiviert." : "Regel wurde pausiert.");
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Regel konnte nicht geändert werden.");
    } finally {
      setRunningId(null);
    }
  };

  const removeRule = async (rule: CleanupRule) => {
    if (!window.confirm("Diese Regel löschen? Bereits verschobene und archivierte Nachrichten bleiben unverändert.")) return;
    try {
      await api.deleteCleanupRule(rule.id);
      setRules((current) => current.filter((item) => item.id !== rule.id));
      onNotify("success", "Regel wurde gelöscht.");
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "Regel konnte nicht gelöscht werden.");
    }
  };

  return (
    <main className="page rules-page">
      <header className="page-header">
        <div><div className="eyebrow">Automatisierung</div><h1>Bereinigungsregeln</h1><p className="page-subtitle">Halte verbundene Postfächer klein, ohne dein lokales Archiv anzutasten.</p></div>
      </header>

      <div className="rules-safety"><ShieldCheck size={21} /><div><strong>Sicheres Prinzip</strong><p>Archiv Hafen verschiebt Treffer ausschließlich in den Papierkorb des Anbieters. Die lokale EML-Archivkopie wird niemals durch eine Regel gelöscht.</p></div></div>

      <section className="rule-builder panel">
        <div className="rule-section-heading"><div><span className="section-kicker">Neue Regel</span><h2>Bedingung festlegen</h2></div></div>
        {connectedAccounts.length ? (
          <>
            <div className="rule-form-grid">
              <label><span>Postfach</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{connectedAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label><span>Bedingung</span><select value={conditionType} onChange={(event) => setConditionType(event.target.value as CleanupConditionType)}><option value="older_than">Älter als</option><option value="sender">Bestimmter Absender</option></select></label>
              {conditionType === "older_than" ? (
                <label><span>Alter in Tagen</span><input type="number" min="1" max="36500" value={olderThanDays} onChange={(event) => setOlderThanDays(Number(event.target.value))} /></label>
              ) : (
                <label><span>Exakte Absenderadresse</span><input type="email" value={sender} onChange={(event) => setSender(event.target.value)} placeholder="newsletter@beispiel.de" /></label>
              )}
            </div>
            <div className="rule-builder-actions">
              <button className="button button--secondary" disabled={previewing || saving} onClick={() => void previewRule()}>{previewing ? <LoaderCircle className="spin" size={17} /> : <Eye size={17} />} Vorschau prüfen</button>
              <button className="button button--primary" disabled={!preview || saving} onClick={() => void createRule()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Regel aktivieren</button>
            </div>
            {preview && <RulePreview preview={preview} />}
          </>
        ) : <div className="rules-empty"><p>Verbinde zuerst ein Postfach, um eine Bereinigungsregel anzulegen.</p></div>}
      </section>

      <section className="rules-list-section">
        <div className="rule-section-heading"><div><span className="section-kicker">Automatisch</span><h2>Gespeicherte Regeln</h2></div><span>{rules.length} {rules.length === 1 ? "Regel" : "Regeln"}</span></div>
        {loading ? <div className="rules-loading"><LoaderCircle className="spin" size={22} /> Regeln werden geladen …</div> : rules.length ? (
          <div className="rules-list">{rules.map((rule) => (
            <article key={rule.id} className={`rule-card ${rule.enabled ? "" : "rule-card--paused"}`}>
              <div className="rule-icon">{rule.conditionType === "older_than" ? <CalendarClock size={20} /> : <AtSign size={20} />}</div>
              <div className="rule-card-main"><strong>{ruleDescription(rule)}</strong><span>{rule.accountName} · {rule.enabled ? "Automatisch aktiv" : "Pausiert"}</span>{rule.lastRunAt && <small>Zuletzt {formatDate(rule.lastRunAt)} · {rule.lastMovedCount} verschoben{rule.lastError ? ` · ${rule.lastError}` : ""}</small>}</div>
              <div className="rule-card-actions">
                <button disabled={runningId === rule.id} onClick={() => void runRule(rule)}>{runningId === rule.id ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} Jetzt ausführen</button>
                <button disabled={runningId === rule.id} onClick={() => void toggleRule(rule)}>{rule.enabled ? <Pause size={15} /> : <Play size={15} />}{rule.enabled ? "Pausieren" : "Aktivieren"}</button>
                <button disabled={runningId === rule.id} className="rule-delete" onClick={() => void removeRule(rule)}><Trash2 size={15} /> Regel löschen</button>
              </div>
            </article>
          ))}</div>
        ) : <div className="rules-empty"><CalendarClock size={27} /><h3>Noch keine Regeln</h3><p>Erstelle oben deine erste automatische Bereinigung.</p></div>}
      </section>
    </main>
  );
}

function RulePreview({ preview }: { preview: CleanupPreview }) {
  return (
    <div className="rule-preview">
      <div><Eye size={18} /><strong>{formatCount(preview.count)} aktuelle Treffer</strong><span>Es wurde noch nichts verschoben.</span></div>
      {preview.examples.length > 0 && <ul>{preview.examples.slice(0, 3).map((message) => <li key={message.id}><strong>{message.sender.name || message.sender.address}</strong><span>{message.subject}</span></li>)}</ul>}
    </div>
  );
}

function ruleDescription(rule: CleanupRule): string {
  return rule.conditionType === "older_than"
    ? `Nachrichten älter als ${rule.olderThanDays} Tage`
    : `Nachrichten von ${rule.sender}`;
}

function toInput(rule: CleanupRule): CleanupRuleInput {
  return {
    accountId: rule.accountId,
    conditionType: rule.conditionType,
    olderThanDays: rule.olderThanDays ?? undefined,
    sender: rule.sender ?? undefined,
    enabled: rule.enabled,
  };
}
