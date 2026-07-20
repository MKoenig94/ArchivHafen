import { useMemo, useState } from "react";
import {
  Archive as ArchiveIcon,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  Inbox,
  LoaderCircle,
  Send,
} from "lucide-react";
import type { Account, Folder } from "../../shared/types";
import { formatCount } from "../lib/format";
import { buildFolderTree, type FolderTreeNode } from "../lib/folder-tree";

export function ArchiveFolderTree({
  accounts,
  folders,
  accountId,
  folderId,
  error,
  onSelectAll,
  onSelectAccount,
  onSelectFolder,
}: {
  accounts: Account[];
  folders: Folder[];
  accountId: string;
  folderId: string;
  error: string | null;
  onSelectAll: () => void;
  onSelectAccount: (accountId: string) => void;
  onSelectFolder: (folder: Folder) => void;
}) {
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(() => new Set());
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const trees = useMemo(() => new Map(accounts.map((account) => [
    account.id,
    buildFolderTree(folders.filter((folder) => folder.accountId === account.id)),
  ])), [accounts, folders]);
  const syncing = accounts.some((account) => account.status === "syncing");

  return (
    <aside className="archive-folder-panel" aria-label="Archivordner">
      <header className="folder-panel-header">
        <div><span>Navigation</span><strong>Archivierte Ordner</strong></div>
        <span className={`folder-live-state ${syncing ? "folder-live-state--syncing" : ""}`}>
          {syncing && <LoaderCircle className="spin" size={11} />}
          {syncing ? "Aktualisiert" : "Dynamisch"}
        </span>
      </header>

      <div className="folder-tree-scroll">
        <button
          className={`folder-all-button ${!accountId && !folderId ? "folder-tree-active" : ""}`}
          onClick={onSelectAll}
          aria-current={!accountId && !folderId ? "page" : undefined}
        >
          <ArchiveIcon size={16} />
          <span>Alle Nachrichten</span>
          <small>{formatCount(accounts.reduce((sum, account) => sum + account.messageCount, 0))}</small>
        </button>

        <div className="folder-account-list">
          {error && <div className="folder-tree-error">{error}</div>}
          {accounts.map((account) => {
            const collapsed = collapsedAccounts.has(account.id);
            const tree = trees.get(account.id) ?? [];
            return (
              <section className="folder-account-group" key={account.id}>
                <div className="folder-account-row">
                  <button
                    className="folder-toggle"
                    onClick={() => toggleSet(setCollapsedAccounts, account.id)}
                    aria-label={`${account.name} ${collapsed ? "aufklappen" : "zuklappen"}`}
                    aria-expanded={!collapsed}
                  >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    className={`folder-account-button ${accountId === account.id && !folderId ? "folder-tree-active" : ""}`}
                    onClick={() => onSelectAccount(account.id)}
                    aria-current={accountId === account.id && !folderId ? "page" : undefined}
                  >
                    <i style={{ backgroundColor: account.color }} />
                    <span><strong>{account.name}</strong><small>{account.connected ? "Postfach" : "Getrennt"}</small></span>
                    <em>{formatCount(account.messageCount)}</em>
                  </button>
                </div>
                {!collapsed && (
                  <div className="folder-node-list">
                    {tree.length ? tree.map((node) => (
                      <FolderNodeRow
                        key={node.path}
                        node={node}
                        accountId={account.id}
                        depth={0}
                        selectedFolderId={folderId}
                        collapsedPaths={collapsedPaths}
                        setCollapsedPaths={setCollapsedPaths}
                        onSelectFolder={onSelectFolder}
                      />
                    )) : <span className="folder-tree-empty">Noch keine Ordner archiviert</span>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function FolderNodeRow({
  node,
  accountId,
  depth,
  selectedFolderId,
  collapsedPaths,
  setCollapsedPaths,
  onSelectFolder,
}: {
  node: FolderTreeNode;
  accountId: string;
  depth: number;
  selectedFolderId: string;
  collapsedPaths: Set<string>;
  setCollapsedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSelectFolder: (folder: Folder) => void;
}) {
  const key = `${accountId}\u0000${node.path}`;
  const collapsed = collapsedPaths.has(key);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div className="folder-node-row" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {hasChildren ? (
          <button
            className="folder-toggle"
            onClick={() => toggleSet(setCollapsedPaths, key)}
            aria-label={`${node.name} ${collapsed ? "aufklappen" : "zuklappen"}`}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : <span className="folder-toggle-spacer" />}
        <button
          className={`folder-node-button ${node.folder?.id === selectedFolderId ? "folder-tree-active" : ""} ${node.folder ? "" : "folder-node-button--group"}`}
          onClick={() => node.folder ? onSelectFolder(node.folder) : toggleSet(setCollapsedPaths, key)}
          aria-current={node.folder?.id === selectedFolderId ? "page" : undefined}
        >
          <FolderGlyph node={node} collapsed={collapsed} />
          <span title={node.name}>{node.name}</span>
          <small>{formatCount(node.messageCount)}</small>
        </button>
      </div>
      {hasChildren && !collapsed && node.children.map((child) => (
        <FolderNodeRow
          key={child.path}
          node={child}
          accountId={accountId}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          collapsedPaths={collapsedPaths}
          setCollapsedPaths={setCollapsedPaths}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </>
  );
}

function FolderGlyph({ node, collapsed }: { node: FolderTreeNode; collapsed: boolean }) {
  switch (node.folder?.specialUse) {
    case "\\Inbox": return <Inbox size={15} />;
    case "\\Sent": return <Send size={15} />;
    case "\\Drafts": return <FileText size={15} />;
    case "\\Archive":
    case "\\All": return <ArchiveIcon size={15} />;
    default: return node.children.length && !collapsed ? <FolderOpen size={15} /> : <FolderIcon size={15} />;
  }
}

function toggleSet(
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  value: string,
): void {
  setter((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}
