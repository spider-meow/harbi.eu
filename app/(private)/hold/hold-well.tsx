"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";

type Props = {
  fill: number;
  over?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
};

export function HoldWell({ fill, over, disabled, onFiles, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localOver, setLocalOver] = useState(false);
  const isOver = over || localOver;
  const shownFill = isOver ? Math.max(fill, 0.1) : fill;

  function take(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const files = Array.from(list);
    if (files.length) onFiles(files);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (!disabled) setLocalOver(true);
  }

  function onDragLeave(event: DragEvent) {
    event.preventDefault();
    setLocalOver(false);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setLocalOver(false);
    take(event.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      aria-label="Drop files into the hold"
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`hold-well relative isolate flex min-h-64 cursor-pointer flex-col items-center justify-center overflow-hidden border px-6 py-14 text-center sm:min-h-72 ${
        isOver
          ? "border-accent bg-accent-soft/40"
          : "border-border bg-surface/50 hover:border-ink-faint"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      style={{ "--hold-fill": String(shownFill) } as CSSProperties}
    >
      <div className="hold-well-fill" aria-hidden="true">
        {shownFill > 0 ? <span className="hold-waterline" /> : null}
      </div>
      {fill < 0.04 && !isOver && (
        <span className="hold-horizon" aria-hidden="true" />
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
