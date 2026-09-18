"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HOLD_MAX_BYTES,
  HOLD_MAX_CONCURRENT,
} from "@/backend/hold/constants";
import {
  deleteHoldFile,
  registerHoldFile,
  signHoldDownload,
  type HoldFile,
} from "@/backend/hold/files";
import { formatBytes, formatEta } from "@/frontend/hold/format";
import { holdKind, holdKindLabel, type HoldKind } from "@/frontend/hold/kind";
import {
  createHoldUpload,
  sanitizeObjectName,
  type HoldUploadController,
} from "@/frontend/hold/upload";
import { HoldWell } from "./hold-well";

type Filter = "all" | "image" | "pdf" | "archive" | "other";

type TransferStatus = "queued" | "uploading" | "paused" | "error";

type Transfer = {
  localId: string;
  file: File;
  name: string;
  size: number;
  mime: string;
  objectPath: string;
  bytesUploaded: number;
  startedAt: number | null;
  speed: number;
  status: TransferStatus;
  error: string | null;
};

type Props = {
  userId: string;
  initialFiles: HoldFile[];
  setupError: string | null;
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDF" },
  { id: "archive", label: "Zip" },
  { id: "other", label: "Other" },
];

function matchesFilter(kind: HoldKind, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "other") {
    return kind !== "image" && kind !== "pdf" && kind !== "archive";
  }
  return kind === filter;
}

function wellCopy(active: Transfer | undefined, over: boolean, empty: boolean) {
  if (over) {
    return {
      title: "Release.",
      detail: "It can rest here.",
    };
  }
  if (active) {
    const pct = active.size
      ? Math.min(99, Math.floor((active.bytesUploaded / active.size) * 100))
      : 0;
    return {
      title: active.status === "paused" ? "Paused" : "Receiving",
      detail: `${active.name} · ${pct}%`,
    };
  }
  if (empty) {
    return {
      title: "Drop it in the well",
      detail: "PDF, images, zip — anything, up to 25 GB.",
    };
  }
  return {
    title: "Drop another",
    detail: "Same well. Same quiet.",
  };
}

export function HoldWorkspace({ userId, initialFiles, setupError }: Props) {
  const [files, setFiles] = useState(initialFiles);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [windowOver, setWindowOver] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(setupError);
  const controllers = useRef(new Map<string, HoldUploadController>());
  const transfersRef = useRef(transfers);
  transfersRef.current = transfers;
  const dragDepth = useRef(0);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  const activeTransfers = transfers.filter(
    (item) => item.status === "uploading" || item.status === "paused",
  );
  const wellFill =
    activeTransfers.length === 0
      ? 0
      : activeTransfers.reduce((sum, item) => sum + item.bytesUploaded, 0) /
        Math.max(
          1,
          activeTransfers.reduce((sum, item) => sum + item.size, 0),
        );
  const primary = activeTransfers[0];
  const empty = files.length === 0 && transfers.length === 0;
  const copy = wellCopy(primary, windowOver, empty);

  const totalBytes = files.reduce((sum, file) => sum + file.size_bytes, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((file) => {
      const kind = holdKind(file.name, file.mime);
      if (!matchesFilter(kind, filter)) return false;
      if (!q) return true;
      return file.name.toLowerCase().includes(q);
    });
  }, [files, filter, query]);

  const startTransfer = useCallback(
    (transfer: Transfer, onFreed: () => void) => {
      if (controllers.current.has(transfer.localId)) return;
      if (!supabaseUrl || !anonKey) {
        setBanner("Missing Supabase keys.");
        return;
      }

      const controller = createHoldUpload({
        file: transfer.file,
        objectPath: transfer.objectPath,
        supabaseUrl,
        anonKey,
        onProgress: (bytes) => {
          const now = Date.now();
          setTransfers((prev) =>
            prev.map((item) => {
              if (item.localId !== transfer.localId) return item;
              const startedAt = item.startedAt ?? now;
              const elapsed = (now - startedAt) / 1000;
              return {
                ...item,
                bytesUploaded: bytes,
                status: "uploading" as const,
                startedAt,
                speed: elapsed > 1 ? bytes / elapsed : item.speed,
              };
            }),
          );
        },
        onSuccess: () => {
          void (async () => {
            try {
              const registered = await registerHoldFile({
                name: transfer.name,
                mime: transfer.mime,
                sizeBytes: transfer.size,
                storagePath: transfer.objectPath,
              });
              setFiles((prev) => [registered, ...prev]);
              setTransfers((prev) =>
                prev.filter((item) => item.localId !== transfer.localId),
              );
            } catch (err) {
              setTransfers((prev) =>
                prev.map((item) =>
                  item.localId === transfer.localId
                    ? {
                        ...item,
                        status: "error",
                        error:
                          err instanceof Error
                            ? err.message
                            : "Landed in storage, but the ledger missed it.",
                      }
                    : item,
                ),
              );
            } finally {
              controllers.current.delete(transfer.localId);
              onFreed();
            }
          })();
        },
        onError: () => {
          setTransfers((prev) =>
            prev.map((item) =>
              item.localId === transfer.localId
                ? {
                    ...item,
                    status: "error",
                    error:
                      "The transfer didn't finish. Drop the same file to resume.",
                  }
                : item,
            ),
          );
          controllers.current.delete(transfer.localId);
          onFreed();
        },
      });

      controllers.current.set(transfer.localId, controller);
      setTransfers((prev) =>
        prev.map((item) =>
          item.localId === transfer.localId
            ? {
                ...item,
                status: "uploading",
                startedAt: item.startedAt ?? Date.now(),
                error: null,
              }
            : item,
        ),
      );
      controller.start();
    },
    [anonKey, supabaseUrl],
  );

  const pump = useCallback(() => {
    const list = transfersRef.current;
    const busy = list.filter(
      (item) => item.status === "uploading" || item.status === "paused",
    ).length;
    if (busy >= HOLD_MAX_CONCURRENT) return;
    const next = list.find(
      (item) =>
        item.status === "queued" && !controllers.current.has(item.localId),
    );
    if (!next) return;
    startTransfer(next, pump);
  }, [startTransfer]);

  const enqueue = useCallback(
    (incoming: File[]) => {
      const additions: Transfer[] = [];
      for (const file of incoming) {
        if (file.size <= 0) {
          setBanner("Nothing to hold — that file is empty.");
          continue;
        }
        if (file.size > HOLD_MAX_BYTES) {
          setBanner(`${file.name} is over 25 GB.`);
          continue;
        }
        additions.push({
          localId: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream",
          objectPath: `${userId}/${crypto.randomUUID()}/${sanitizeObjectName(file.name)}`,
          bytesUploaded: 0,
          startedAt: null,
          speed: 0,
          status: "queued",
          error: null,
        });
      }
      if (!additions.length) return;
      setBanner(null);
      setTransfers((prev) => [...prev, ...additions]);
    },
    [userId],
  );

  const queuedCount = transfers.filter((item) => item.status === "queued").length;
  const uploadingCount = transfers.filter(
    (item) => item.status === "uploading",
  ).length;
  const pausedCount = transfers.filter((item) => item.status === "paused").length;

  useEffect(() => {
    pump();
  }, [queuedCount, uploadingCount, pausedCount, pump]);

  useEffect(() => {
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }
    function onEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      dragDepth.current += 1;
      setWindowOver(true);
    }
    function onOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
    }
    function onLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setWindowOver(false);
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setWindowOver(false);
      const list = event.dataTransfer?.files;
      if (list?.length) enqueue(Array.from(list));
    }
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [enqueue]);

  useEffect(() => {
    if (transfers.length === 0) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [transfers.length]);

  async function handlePause(localId: string) {
    const controller = controllers.current.get(localId);
    await controller?.pause();
    setTransfers((prev) =>
      prev.map((item) =>
        item.localId === localId ? { ...item, status: "paused" } : item,
      ),
    );
  }

  function handleResume(localId: string) {
    const controller = controllers.current.get(localId);
    if (controller) {
      setTransfers((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? { ...item, status: "uploading", error: null }
            : item,
        ),
      );
      controller.resume();
      return;
    }
    const transfer = transfersRef.current.find((item) => item.localId === localId);
    if (transfer) {
      setTransfers((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? { ...item, status: "queued", error: null }
            : item,
        ),
      );
    }
  }

  async function handleCancel(localId: string) {
    const controller = controllers.current.get(localId);
    try {
      await controller?.cancel();
    } catch {
      // already gone
    }
    controllers.current.delete(localId);
    setTransfers((prev) => prev.filter((item) => item.localId !== localId));
  }

  async function handleDownload(file: HoldFile) {
    setBusyId(file.id);
    setBanner(null);
    try {
      const url = await signHoldDownload(file.id);
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setBanner(null);
    try {
      await deleteHoldFile(id);
      setFiles((prev) => prev.filter((file) => file.id !== id));
      setConfirmId(null);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Could not remove it");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <header className="animate-rise">
        <p className="font-mono text-sm text-accent">~/hold</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Hold
          </h1>
          <p className="font-mono text-[11px] text-ink-faint">
            {files.length === 0
              ? "empty"
              : `${files.length} · ${formatBytes(totalBytes)}`}
          </p>
        </div>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          A quiet place for heavy things. They stay until you take them back.
        </p>
      </header>

      {banner && (
        <p className="font-mono text-xs text-accent" role="status">
          {banner}
        </p>
      )}

      <HoldWell fill={wellFill} over={windowOver} onFiles={enqueue}>
        <p className="font-display text-2xl font-medium text-ink sm:text-3xl">
          {copy.title}
        </p>
        <p className="mt-2 max-w-sm text-sm text-ink-muted">{copy.detail}</p>
        {!primary && (
          <p className="mt-5 font-mono text-[11px] text-ink-faint">
            If a transfer stops, drop the same file again.
          </p>
        )}
      </HoldWell>

      {transfers.length > 0 && (
        <section className="animate-rise-delay space-y-3">
          <p className="font-mono text-[11px] text-ink-faint">In transit</p>
          <ul className="divide-y divide-border border-y border-border">
            {transfers.map((item) => (
              <TransferRow
                key={item.localId}
                transfer={item}
                onPause={() => void handlePause(item.localId)}
                onResume={() => handleResume(item.localId)}
                onCancel={() => void handleCancel(item.localId)}
              />
            ))}
          </ul>
        </section>
      )}

      {files.length > 0 && (
        <section className="animate-rise-delay-2 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              {FILTERS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilter(chip.id)}
                  className={`font-mono text-xs ${
                    filter === chip.id
                      ? "text-accent"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <label className="block sm:w-56">
              <span className="sr-only">Find a file</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a file"
                className="w-full border-b border-border bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
          </div>

          <ul className="divide-y divide-border border-t border-border">
            {visible.map((file) => {
              const kind = holdKind(file.name, file.mime);
              return (
                <li
                  key={file.id}
                  className="flex items-center gap-4 py-4"
                >
                  <FileMark file={file} kind={kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{file.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                      {holdKindLabel(kind)}
                    </p>
                  </div>
                  <p className="shrink-0 font-display text-lg tracking-tight text-ink">
                    {formatBytes(file.size_bytes)}
                  </p>
                  <div className="flex shrink-0 gap-3">
                    <button
                      type="button"
                      disabled={busyId === file.id}
                      onClick={() => void handleDownload(file)}
                      className="font-mono text-xs text-ink-muted hover:text-ink"
                    >
                      {busyId === file.id ? "wait" : "take"}
                    </button>
                    {confirmId === file.id ? (
                      <button
                        type="button"
                        disabled={busyId === file.id}
                        onClick={() => void handleDelete(file.id)}
                        className="font-mono text-xs text-accent hover:text-accent-strong"
                      >
                        confirm
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(file.id)}
                        className="font-mono text-xs text-ink-muted hover:text-ink"
                      >
                        remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="py-6 font-mono text-sm text-ink-faint">
                Nothing matches.
              </li>
            )}
          </ul>
        </section>
      )}

      {windowOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-canvas/70 backdrop-blur-[2px]">
          <div className="flex h-full items-center justify-center">
            <p className="font-display text-4xl font-medium text-ink">
              Release.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FileMark({ file, kind }: { file: HoldFile; kind: HoldKind }) {
  if (file.previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.previewUrl}
        alt=""
        className="h-12 w-12 shrink-0 object-cover"
      />
    );
  }
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-surface font-mono text-[10px] uppercase tracking-wide text-ink-muted">
      {holdKindLabel(kind).slice(0, 4)}
    </span>
  );
}

function TransferRow({
  transfer,
  onPause,
  onResume,
  onCancel,
}: {
  transfer: Transfer;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const ratio = transfer.size
    ? Math.min(1, transfer.bytesUploaded / transfer.size)
    : 0;
  const remaining =
    transfer.speed > 0
      ? (transfer.size - transfer.bytesUploaded) / transfer.speed
      : null;
  const eta =
    transfer.status === "uploading" && remaining != null
      ? formatEta(remaining)
      : null;

  return (
    <li className="py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 truncate text-sm text-ink">{transfer.name}</p>
        <p className="shrink-0 font-display text-lg tracking-tight text-ink">
          {formatBytes(transfer.size)}
        </p>
      </div>
      <div className="mt-3 h-px w-full bg-border">
        <div
          className="h-px bg-accent transition-[width] duration-200"
          style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 1 : 0)}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-ink-faint">
          {transfer.error
            ? transfer.error
            : transfer.status === "queued"
              ? "waiting"
              : transfer.status === "paused"
                ? "paused"
                : eta
                  ? `${Math.floor(ratio * 100)}% · ${eta}`
                  : `${Math.floor(ratio * 100)}%`}
        </p>
        <div className="flex gap-3">
          {transfer.status === "uploading" && (
            <button
              type="button"
              onClick={onPause}
              className="font-mono text-xs text-ink-muted hover:text-ink"
            >
              pause
            </button>
          )}
          {(transfer.status === "paused" || transfer.status === "error") && (
            <button
              type="button"
              onClick={onResume}
              className="font-mono text-xs text-ink-muted hover:text-ink"
            >
              resume
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-xs text-ink-muted hover:text-ink"
          >
            cancel
          </button>
        </div>
      </div>
    </li>
  );
}
