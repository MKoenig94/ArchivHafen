export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: index > 1 ? 1 : 0,
  }).format(value)} ${units[index]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

export function formatDate(value: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "Noch nie";
  return new Intl.DateTimeFormat("de-DE", options ?? {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatMessageDate(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("de-DE", sameYear
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

export function relativeTime(value: string | null): string {
  if (!value) return "Noch keine Synchronisierung";
  const delta = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(delta / 3_600_000);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(delta / 86_400_000), "day");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}
