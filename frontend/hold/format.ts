export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function formatEta(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 20) return "a few seconds left";
  if (seconds < 90) return "about a minute left";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
  const hours = seconds / 3600;
  if (hours < 1.5) return "about an hour left";
  return `${hours.toFixed(1)} h left`;
}
