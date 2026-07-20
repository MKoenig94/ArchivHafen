import type { MessagePage } from "../../shared/types";

export function mergeMessagePages(current: MessagePage | null, next: MessagePage): MessagePage {
  if (!current || next.page === 1) return next;

  const existingIds = new Set(current.items.map((message) => message.id));
  return {
    ...next,
    items: [
      ...current.items,
      ...next.items.filter((message) => !existingIds.has(message.id)),
    ],
  };
}
