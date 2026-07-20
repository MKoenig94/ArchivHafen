import { describe, expect, it } from "vitest";
import type { MessagePage, MessageSummary } from "../src/shared/types";
import { mergeMessagePages } from "../src/client/lib/message-pages";

describe("fortlaufende Nachrichtenliste", () => {
  it("hängt die nächste Seite an die vorhandenen Nachrichten an", () => {
    const merged = mergeMessagePages(page(1, ["eins", "zwei"]), page(2, ["drei", "vier"]));

    expect(merged.items.map((message) => message.id)).toEqual(["eins", "zwei", "drei", "vier"]);
    expect(merged.page).toBe(2);
  });

  it("überspringt Überschneidungen zwischen zwei Seiten", () => {
    const merged = mergeMessagePages(page(1, ["eins", "zwei"]), page(2, ["zwei", "drei"]));

    expect(merged.items.map((message) => message.id)).toEqual(["eins", "zwei", "drei"]);
  });

  it("ersetzt bei Seite eins den bisherigen Listeninhalt", () => {
    const merged = mergeMessagePages(page(3, ["alt"]), page(1, ["neu"]));

    expect(merged.items.map((message) => message.id)).toEqual(["neu"]);
  });
});

function page(number: number, ids: string[]): MessagePage {
  return {
    items: ids.map(message),
    total: 4,
    page: number,
    pageSize: 2,
    pageCount: 2,
  };
}

function message(id: string): MessageSummary {
  return {
    id,
    accountId: "account",
    accountName: "Testpostfach",
    accountColor: "#285d41",
    folderId: "folder",
    folder: "Posteingang",
    subject: id,
    sender: { name: "Absender", address: "sender@example.test" },
    recipients: [{ name: "Empfänger", address: "recipient@example.test" }],
    sentAt: "2026-07-20T10:00:00.000Z",
    receivedAt: "2026-07-20T10:00:00.000Z",
    preview: "Vorschau",
    flags: [],
    size: 100,
    hasAttachments: false,
    attachmentCount: 0,
    archivedAt: "2026-07-20T10:00:00.000Z",
    remoteDeletedAt: null,
  };
}
