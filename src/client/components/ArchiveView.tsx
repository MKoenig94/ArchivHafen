import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Download,
  FileDown,
  Filter,
  Inbox,
  LoaderCircle,
  MailOpen,
  Paperclip,
  Search,
  ShieldOff,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { Account, Folder, MessageDetail, MessagePage, MessageSummary } from "../../shared/types";
import { api } from "../lib/api";
import { formatBytes, formatCount, formatDate, formatMessageDate } from "../lib/format";
import { mergeMessagePages } from "../lib/message-pages";

const MESSAGE_PAGE_SIZE = 35;

export function ArchiveView({ accounts, onNotify }: {
  accounts: Account[];
  onNotify: (type: "success" | "error", message: string) => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [messages, setMessages] = useState<MessagePage | null>(null);
  const [accountId, setAccountId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedForTrash, setSelectedForTrash] = useState<Set<string>>(() => new Set());
  const [trashing, setTrashing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
      setPage(1);
      setSelectedId(null);
      setSelectedForTrash(new Set());
    }, 280);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    let active = true;
    api.folders(accountId || undefined).then((result) => {
      if (active) setFolders(result);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Ordner konnten nicht geladen werden.");
    });
    return () => { active = false; };
  }, [accountId]);

  useEffect(() => {
    let active = true;
    const firstPage = page === 1;
    if (firstPage) {
      loadingMoreRef.current = false;
      setMessages(null);
      setLoading(true);
      setLoadingMore(false);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setError(null);
    api.messages({
      page,
      pageSize: MESSAGE_PAGE_SIZE,
      q: query || undefined,
      accountId: accountId || undefined,
      folderId: folderId || undefined,
      attachments: attachmentsOnly,
    }).then((result) => {
      if (!active) return;
      setMessages((current) => mergeMessagePages(current, result));
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      if (firstPage) listRef.current?.scrollTo({ top: 0 });
    }).catch((caught) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Archiv konnte nicht geladen werden.");
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    });
    return () => { active = false; };
  }, [accountId, attachmentsOnly, folderId, page, query, requestVersion]);

  const selectAccount = (value: string) => {
    setAccountId(value);
    setFolderId("");
    setPage(1);
    setSelectedId(null);
    setSelectedForTrash(new Set());
  };

  const selected = useMemo(
    () => messages?.items.find((message) => message.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const connectedAccountIds = useMemo(
    () => new Set(accounts.filter((account) => account.connected).map((account) => account.id)),
    [accounts],
  );
  const connected = accounts.some((account) => account.connected);
  const hasFilters = Boolean(accountId || folderId || query || attachmentsOnly);
  const hasMore = Boolean(messages && messages.page < messages.pageCount);
  const selectableMessages = messages?.items.filter(
    (message) => !message.remoteDeletedAt && connectedAccountIds.has(message.accountId),
  ) ?? [];
  const allLoadedSelected = selectableMessages.length > 0
    && selectableMessages.every((message) => selectedForTrash.has(message.id));

  const loadNextPage = () => {
    if (!messages || !hasMore || loading || loadingMoreRef.current || error) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setPage((value) => value + 1);
  };

  const retry = () => {
    loadingMoreRef.current = page > 1;
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    setRequestVersion((value) => value + 1);
  };

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 420) loadNextPage();
  };

  const toggleSelected = (id: string) => {
    setSelectedForTrash((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllLoaded = () => {
    setSelectedForTrash((current) => {
      const next = new Set(current);
      if (allLoadedSelected) {
        for (const message of selectableMessages) next.delete(message.id);
      } else {
        for (const message of selectableMessages) next.add(message.id);
      }
      return next;
    });
  };

  const moveToTrash = async (ids: string[]): Promise<string[]> => {
    const uniqueIds = [...new Set(ids)].filter((id) => {
      const message = messages?.items.find((item) => item.id === id);
      return message && !message.remoteDeletedAt && connectedAccountIds.has(message.accountId);
    });
    if (!uniqueIds.length || trashing) return [];
    const label = uniqueIds.length === 1 ? "diese Nachricht" : `${uniqueIds.length} Nachrichten`;
    if (!window.confirm(
      `Möchtest du ${label} im verbundenen Postfach in den Papierkorb verschieben?\n\nDie lokale Archivkopie bleibt vollständig erhalten.`,
    )) return [];

    setTrashing(true);
    const movedIds: string[] = [];
    const failures: Array<{ id: string; error: string }> = [];
    try {
      for (let offset = 0; offset < uniqueIds.length; offset += 100) {
        const result = await api.trashMessages(uniqueIds.slice(offset, offset + 100));
        movedIds.push(...result.movedIds);
        failures.push(...result.failed);
      }
      if (movedIds.length) {
        const deletedAt = new Date().toISOString();
        const moved = new Set(movedIds);
        setMessages((current) => current ? {
          ...current,
          items: current.items.map((message) => moved.has(message.id)
            ? { ...message, remoteDeletedAt: deletedAt }
            : message),
        } : current);
        setSelectedForTrash((current) => {
          const next = new Set(current);
          for (const id of movedIds) next.delete(id);
          return next;
        });
      }
      if (failures.length) {
        onNotify("error", `${movedIds.length} verschoben, ${failures.length} fehlgeschlagen: ${failures[0].error}`);
      } else {
        onNotify("success", movedIds.length === 1
          ? "Nachricht wurde im Postfach in den Papierkorb verschoben."
          : `${movedIds.length} Nachrichten wurden im Postfach in den Papierkorb verschoben.`);
      }
      return movedIds;
    } catch (caught) {
      onNotify("error", caught instanceof Error ? caught.message : "Nachrichten konnten nicht verschoben werden.");
      return movedIds;
    } finally {
      setTrashing(false);
    }
  };

  return (
    <main className="page archive-page">
      <header className="page-header archive-header">
        <div><div className="eyebrow">Langzeitarchiv</div><h1>Alle Nachrichten</h1><p className="page-subtitle">Finde jede E-Mail in Sekunden – anbieterübergreifend.</p></div>
        <div className="archive-total"><Archive size={17} /><strong>{formatCount(messages?.total ?? 0)}</strong><span>Treffer</span></div>
      </header>

      <section className="archive-toolbar">
        <label className="archive-search">
          <Search size={19} />
          <input
            ref={searchRef}
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Betreff, Absender oder Inhalt durchsuchen …"
            aria-label="Archiv durchsuchen"
          />
          {queryInput && <button onClick={() => setQueryInput("")} aria-label="Suche leeren"><X size={17} /></button>}
          <kbd>Ctrl K</kbd>
        </label>
        <div className="filter-select-wrap">
          <UserRound size={16} />
          <select value={accountId} onChange={(event) => selectAccount(event.target.value)} aria-label="Postfach filtern">
            <option value="">Alle Postfächer</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <ChevronDown size={15} />
        </div>
        <div className="filter-select-wrap">
          <Inbox size={16} />
          <select value={folderId} onChange={(event) => { setFolderId(event.target.value); setPage(1); setSelectedId(null); setSelectedForTrash(new Set()); }} aria-label="Ordner filtern">
            <option value="">Alle Ordner</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} ({folder.messageCount})</option>)}
          </select>
          <ChevronDown size={15} />
        </div>
        <button
          className={`filter-button ${attachmentsOnly ? "filter-button--active" : ""}`}
          onClick={() => { setAttachmentsOnly((value) => !value); setPage(1); setSelectedId(null); setSelectedForTrash(new Set()); }}
        >
          <Paperclip size={16} /> Mit Anhang
        </button>
      </section>

      <section className={`archive-workspace ${selectedId ? "archive-workspace--reader" : ""}`}>
        <div className="message-list-panel">
          <div className={`list-caption ${selectedForTrash.size ? "list-caption--selected" : ""}`}>
            <label className="select-all-control">
              <input
                type="checkbox"
                checked={allLoadedSelected}
                onChange={toggleAllLoaded}
                disabled={!selectableMessages.length || trashing}
              />
              <span>{selectedForTrash.size
                ? `${selectedForTrash.size} ausgewählt`
                : hasFilters ? `${formatCount(messages?.total ?? 0)} passende Nachrichten` : "Chronologisch sortiert"}</span>
            </label>
            {selectedForTrash.size ? (
              <div className="selection-actions">
                <button disabled={trashing} onClick={() => void moveToTrash([...selectedForTrash])}>
                  {trashing ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                  In Papierkorb
                </button>
                <button disabled={trashing} onClick={() => setSelectedForTrash(new Set())}>Auswahl aufheben</button>
              </div>
            ) : <span><SlidersHorizontal size={14} /> Neueste zuerst</span>}
          </div>
          <div
            className="message-list"
            ref={listRef}
            onScroll={handleListScroll}
            aria-busy={loading || loadingMore}
            aria-label="Nachrichtenliste"
            role="region"
            tabIndex={0}
          >
            {loading ? (
              <div className="list-loading"><LoaderCircle size={24} className="spin" /><span>Archiv wird durchsucht …</span></div>
            ) : messages?.items.length ? (
              messages.items.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  selected={selectedId === message.id}
                  checked={selectedForTrash.has(message.id)}
                  canTrash={connectedAccountIds.has(message.accountId)}
                  onCheck={() => toggleSelected(message.id)}
                  onClick={() => setSelectedId(message.id)}
                />
              ))
            ) : error ? (
              <div className="list-empty"><ShieldOff size={28} /><h3>Archiv nicht erreichbar</h3><p>{error}</p><button className="text-button" onClick={retry}>Erneut versuchen</button></div>
            ) : (
              <div className="list-empty">
                {connected ? <Search size={30} /> : <Inbox size={30} />}
                <h3>{connected ? "Keine Nachrichten gefunden" : "Dein Archiv ist noch leer"}</h3>
                <p>{connected ? "Probiere einen anderen Suchbegriff oder entferne Filter." : "Verbinde ein Postfach und starte die erste Archivierung."}</p>
                {hasFilters && <button className="text-button" onClick={() => { setQueryInput(""); setAccountId(""); setFolderId(""); setAttachmentsOnly(false); setPage(1); setSelectedId(null); setSelectedForTrash(new Set()); }}>Alle Filter zurücksetzen</button>}
              </div>
            )}
          </div>
          {messages && messages.total > 0 && (
            <footer className="archive-list-status" aria-live="polite">
              <span>{formatCount(messages.items.length)} von {formatCount(messages.total)} geladen</span>
              {loadingMore ? (
                <span className="archive-list-progress"><LoaderCircle size={14} className="spin" /> Weitere werden geladen …</span>
              ) : error ? (
                <button onClick={retry}>Nachladen fehlgeschlagen · Erneut versuchen</button>
              ) : hasMore ? (
                <button onClick={loadNextPage}>Weiter scrollen oder hier nachladen</button>
              ) : (
                <span>Ende des Archivs</span>
              )}
            </footer>
          )}
        </div>

        <div className="reader-panel">
          {selected ? <MessageReader
            summary={selected}
            trashing={trashing}
            canTrash={connectedAccountIds.has(selected.accountId)}
            onTrash={async () => (await moveToTrash([selected.id])).includes(selected.id)}
            onClose={() => setSelectedId(null)}
          /> : (
            <div className="reader-placeholder"><div><MailOpen size={34} /></div><h3>Nachricht auswählen</h3><p>Der Inhalt wird sicher und ohne externe Bilder angezeigt.</p></div>
          )}
        </div>
      </section>
    </main>
  );
}

function MessageRow({ message, selected, checked, canTrash, onCheck, onClick }: {
  message: MessageSummary;
  selected: boolean;
  checked: boolean;
  canTrash: boolean;
  onCheck: () => void;
  onClick: () => void;
}) {
  const unavailable = Boolean(message.remoteDeletedAt) || !canTrash;
  return (
    <div className={`message-row ${selected ? "message-row--selected" : ""} ${message.remoteDeletedAt ? "message-row--remote-deleted" : ""}`}>
      <span className="message-account-line" style={{ backgroundColor: message.accountColor }} />
      <label className="message-checkbox" title={message.remoteDeletedAt ? "Bereits in den Papierkorb verschoben" : canTrash ? "Nachricht auswählen" : "Postfach ist nicht verbunden"}>
        <input
          type="checkbox"
          checked={checked}
          disabled={unavailable}
          onChange={onCheck}
          aria-label={`${message.subject} auswählen`}
        />
      </label>
      <button className="message-row-open" onClick={onClick}>
        <span className="message-row-main">
        <span className="message-row-top">
          <strong>{message.sender.name || message.sender.address || "Unbekannt"}</strong>
          <time>{formatMessageDate(message.sentAt ?? message.receivedAt)}</time>
        </span>
        <span className="message-row-subject">{message.subject}</span>
        <span className="message-row-preview">{message.preview || "Keine Textvorschau verfügbar."}</span>
        <span className="message-row-footer">
          <span className="folder-chip">{message.folder}</span>
          <span className="account-chip"><i style={{ backgroundColor: message.accountColor }} />{message.accountName}</span>
          {message.remoteDeletedAt && <span className="remote-deleted-chip"><Trash2 size={12} /> Im Papierkorb</span>}
          {message.hasAttachments && <span className="attachment-count"><Paperclip size={13} /> {message.attachmentCount}</span>}
        </span>
        </span>
      </button>
    </div>
  );
}

function MessageReader({ summary, trashing, canTrash, onTrash, onClose }: {
  summary: MessageSummary;
  trashing: boolean;
  canTrash: boolean;
  onTrash: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [message, setMessage] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let active = true;
    setMessage(null);
    setError(null);
    api.message(summary.id).then((result) => active && setMessage(result)).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Nachricht konnte nicht geöffnet werden.");
    });
    return () => { active = false; };
  }, [summary.id]);

  return (
    <article className="message-reader">
      <header className="reader-toolbar">
        <button className="reader-back" onClick={onClose}><ArrowLeft size={17} /> <span>Zurück</span></button>
        <div>
          <a className="reader-action" href={`/api/messages/${summary.id}/raw`}><FileDown size={16} /> <span>Original laden</span></a>
          <button
            className="reader-action reader-action--danger"
            disabled={trashing || !canTrash || Boolean(summary.remoteDeletedAt || message?.remoteDeletedAt)}
            onClick={async () => {
              if (await onTrash()) {
                setMessage((current) => current ? { ...current, remoteDeletedAt: new Date().toISOString() } : current);
              }
            }}
          >
            {trashing ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            <span>{summary.remoteDeletedAt || message?.remoteDeletedAt ? "Im Papierkorb" : canTrash ? "In Papierkorb" : "Postfach getrennt"}</span>
          </button>
          <button className="icon-button reader-close" onClick={onClose} aria-label="Nachricht schließen"><X size={19} /></button>
        </div>
      </header>

      {!message && !error && <div className="reader-loading"><LoaderCircle className="spin" size={24} /><span>Nachricht wird geöffnet …</span></div>}
      {error && <div className="reader-loading"><ShieldOff size={26} /><span>{error}</span></div>}
      {message && (
        <div className="reader-scroll" aria-label="Nachrichteninhalt" role="region" tabIndex={0}>
          <div className="reader-heading">
            <div className="reader-labels"><span className="folder-chip">{message.folder}</span>{message.hasAttachments && <span><Paperclip size={13} /> {message.attachmentCount}</span>}</div>
            <h2>{message.subject}</h2>
          </div>
          <div className="sender-block">
            <span className="reader-avatar" style={{ backgroundColor: `${message.accountColor}18`, color: message.accountColor }}>
              {(message.sender.name || message.sender.address || "?").slice(0, 1).toUpperCase()}
            </span>
            <div className="sender-main">
              <strong>{message.sender.name || message.sender.address || "Unbekannt"}</strong>
              <button onClick={() => setShowDetails((value) => !value)}>
                an {message.recipients[0]?.name || message.recipients[0]?.address || "mich"} <ChevronDown size={13} />
              </button>
            </div>
            <time>{formatDate(message.sentAt ?? message.receivedAt, { dateStyle: "medium", timeStyle: "short" })}</time>
          </div>
          {showDetails && (
            <div className="message-details">
              <div><span>Von</span><strong>{addressLine([message.sender])}</strong></div>
              <div><span>An</span><strong>{addressLine(message.recipients)}</strong></div>
              {message.cc.length > 0 && <div><span>CC</span><strong>{addressLine(message.cc)}</strong></div>}
              <div><span>Archiv</span><strong>{message.accountName} / {message.folder}</strong></div>
              <div><span>Größe</span><strong>{formatBytes(message.size)}</strong></div>
            </div>
          )}
          <div className="privacy-banner"><ShieldOff size={15} /><span>Externe Bilder und aktive Inhalte wurden zu deiner Privatsphäre blockiert.</span></div>
          {message.remoteDeletedAt && <div className="remote-deleted-banner"><Trash2 size={15} /><span>Diese Nachricht wurde im verbundenen Postfach in den Papierkorb verschoben. Die lokale Archivkopie bleibt erhalten.</span></div>}
          <div className="email-body">
            {message.html
              ? <div dangerouslySetInnerHTML={{ __html: message.html }} />
              : <pre>{message.text || "Diese Nachricht enthält keinen darstellbaren Text."}</pre>}
          </div>
          {message.attachments.length > 0 && (
            <section className="attachments-section">
              <h3><Paperclip size={17} /> {message.attachments.length} {message.attachments.length === 1 ? "Anhang" : "Anhänge"}</h3>
              <div className="attachment-grid">
                {message.attachments.map((attachment) => (
                  <a key={attachment.index} href={`/api/messages/${message.id}/attachments/${attachment.index}`} className="attachment-card">
                    <span className="file-icon">{fileExtension(attachment.filename)}</span>
                    <span><strong>{attachment.filename}</strong><small>{formatBytes(attachment.size)} · {attachment.contentType}</small></span>
                    <Download size={17} />
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </article>
  );
}

function addressLine(items: Array<{ name: string; address: string }>): string {
  return items.map((item) => item.name && item.address ? `${item.name} <${item.address}>` : item.name || item.address).join(", ") || "–";
}

function fileExtension(filename: string): string {
  const extension = filename.split(".").pop()?.slice(0, 4).toUpperCase();
  return extension && extension !== filename.toUpperCase() ? extension : "DATEI";
}
