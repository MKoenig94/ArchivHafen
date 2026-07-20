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
  UserRound,
  X,
} from "lucide-react";
import type { Account, Folder, MessageDetail, MessagePage, MessageSummary } from "../../shared/types";
import { api } from "../lib/api";
import { formatBytes, formatCount, formatDate, formatMessageDate } from "../lib/format";
import { mergeMessagePages } from "../lib/message-pages";

const MESSAGE_PAGE_SIZE = 35;

export function ArchiveView({ accounts }: { accounts: Account[] }) {
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
  };

  const selected = useMemo(
    () => messages?.items.find((message) => message.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const connected = accounts.some((account) => account.connected);
  const hasFilters = Boolean(accountId || folderId || query || attachmentsOnly);
  const hasMore = Boolean(messages && messages.page < messages.pageCount);

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
          <select value={folderId} onChange={(event) => { setFolderId(event.target.value); setPage(1); setSelectedId(null); }} aria-label="Ordner filtern">
            <option value="">Alle Ordner</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} ({folder.messageCount})</option>)}
          </select>
          <ChevronDown size={15} />
        </div>
        <button
          className={`filter-button ${attachmentsOnly ? "filter-button--active" : ""}`}
          onClick={() => { setAttachmentsOnly((value) => !value); setPage(1); setSelectedId(null); }}
        >
          <Paperclip size={16} /> Mit Anhang
        </button>
      </section>

      <section className={`archive-workspace ${selectedId ? "archive-workspace--reader" : ""}`}>
        <div className="message-list-panel">
          <div className="list-caption">
            <span>{hasFilters ? `${formatCount(messages?.total ?? 0)} passende Nachrichten` : "Chronologisch sortiert"}</span>
            <span><SlidersHorizontal size={14} /> Neueste zuerst</span>
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
                {hasFilters && <button className="text-button" onClick={() => { setQueryInput(""); setAccountId(""); setFolderId(""); setAttachmentsOnly(false); setPage(1); setSelectedId(null); }}>Alle Filter zurücksetzen</button>}
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
          {selected ? <MessageReader summary={selected} onClose={() => setSelectedId(null)} /> : (
            <div className="reader-placeholder"><div><MailOpen size={34} /></div><h3>Nachricht auswählen</h3><p>Der Inhalt wird sicher und ohne externe Bilder angezeigt.</p></div>
          )}
        </div>
      </section>
    </main>
  );
}

function MessageRow({ message, selected, onClick }: {
  message: MessageSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`message-row ${selected ? "message-row--selected" : ""}`} onClick={onClick}>
      <span className="message-account-line" style={{ backgroundColor: message.accountColor }} />
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
          {message.hasAttachments && <span className="attachment-count"><Paperclip size={13} /> {message.attachmentCount}</span>}
        </span>
      </span>
    </button>
  );
}

function MessageReader({ summary, onClose }: { summary: MessageSummary; onClose: () => void }) {
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
