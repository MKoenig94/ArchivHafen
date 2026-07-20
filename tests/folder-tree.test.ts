import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArchiveFolderTree } from "../src/client/components/ArchiveFolderTree";
import { buildFolderTree } from "../src/client/lib/folder-tree";
import type { Account, Folder } from "../src/shared/types";

describe("IMAP-Ordnerbaum", () => {
  it("baut verschachtelte Serverpfade mit synthetischen Eltern auf", () => {
    const tree = buildFolderTree([
      folder("inbox", "INBOX", "Posteingang", "\\Inbox", 12, null),
      folder("sent", "[Gmail]/Gesendet", "Gesendet", "\\Sent", 4, "[Gmail]"),
      folder("project", "[Gmail]/Projekte/2026", "2026", null, 7, "[Gmail]/Projekte"),
    ]);

    expect(tree.map((node) => node.name)).toEqual(["Posteingang", "[Gmail]"]);
    expect(tree[1].folder).toBeNull();
    expect(tree[1].messageCount).toBe(11);
    expect(tree[1].children.map((node) => node.name)).toEqual(["Gesendet", "Projekte"]);
    expect(tree[1].children[1].children[0].folder?.id).toBe("project");
  });

  it("erkennt bei migrierten Ordnern weiterhin Schrägstrich-Hierarchien", () => {
    const tree = buildFolderTree([
      { ...folder("customer", "Kunden/Berlin", "Berlin", null, 3, null), delimiter: null },
    ]);

    expect(tree[0].name).toBe("Kunden");
    expect(tree[0].children[0].name).toBe("Berlin");
    expect(tree[0].messageCount).toBe(3);
  });

  it("verwendet das vom IMAP-Server gelieferte Trennzeichen", () => {
    const tree = buildFolderTree([
      { ...folder("dot", "Kunden.Berlin.2026", "2026", null, 2, "Kunden.Berlin"), delimiter: "." },
    ]);

    expect(tree[0].name).toBe("Kunden");
    expect(tree[0].children[0].name).toBe("Berlin");
    expect(tree[0].children[0].children[0].folder?.id).toBe("dot");
  });

  it("rendert Postfach, Ordner und Archivzähler", () => {
    const html = renderToStaticMarkup(createElement(ArchiveFolderTree, {
      accounts: [account()],
      folders: [folder("inbox", "INBOX", "Posteingang", "\\Inbox", 12, null)],
      accountId: "",
      folderId: "",
      error: null,
      onSelectAll: () => undefined,
      onSelectAccount: () => undefined,
      onSelectFolder: () => undefined,
    }));

    expect(html).toContain("Archivierte Ordner");
    expect(html).toContain("Alle Nachrichten");
    expect(html).toContain("Posteingang");
    expect(html).toContain("12");
  });
});

function account(): Account {
  return {
    id: "account",
    name: "Testpostfach",
    email: "test@example.test",
    provider: "custom",
    imapHost: "imap.example.test",
    imapPort: 993,
    imapSecure: true,
    username: "test@example.test",
    color: "#285d41",
    connected: true,
    createdAt: "2026-07-20T10:00:00.000Z",
    lastSyncAt: "2026-07-20T11:00:00.000Z",
    status: "ready",
    lastError: null,
    messageCount: 12,
  };
}

function folder(
  id: string,
  path: string,
  name: string,
  specialUse: string | null,
  messageCount: number,
  parentPath: string | null,
): Folder {
  return {
    id,
    accountId: "account",
    path,
    name,
    specialUse,
    delimiter: "/",
    parentPath,
    messageCount,
    lastSyncAt: null,
  };
}
