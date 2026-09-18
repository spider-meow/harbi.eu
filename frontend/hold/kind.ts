export type HoldKind = "pdf" | "image" | "archive" | "video" | "audio" | "file";

const ARCHIVE_EXT = /\.(zip|zipx|7z|rar|tar|tgz|gz|bz2)$/i;
const ARCHIVE_MIME = /zip|x-7z|x-rar|x-tar|gzip|x-gzip|x-bzip2/;

export function holdKind(
  name: string,
  mime: string | null | undefined,
): HoldKind {
  const m = (mime ?? "").toLowerCase();
  const n = name.toLowerCase();
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (
    m.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|tiff?)$/i.test(n)
  ) {
    return "image";
  }
  if (m.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi)$/i.test(n)) {
    return "video";
  }
  if (m.startsWith("audio/") || /\.(mp3|wav|flac|aac|ogg|m4a)$/i.test(n)) {
    return "audio";
  }
  if (ARCHIVE_MIME.test(m) || ARCHIVE_EXT.test(n)) return "archive";
  return "file";
}

export function holdKindLabel(kind: HoldKind): string {
  if (kind === "archive") return "zip";
  return kind;
}
