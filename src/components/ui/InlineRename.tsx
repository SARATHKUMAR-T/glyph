import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

/** Text input that saves on Enter/blur, cancels on Escape, and discards an
 * empty or unchanged name. Events are stopped so it can sit inside
 * draggable tabs and pane headers without triggering their handlers. */
export function RenameInput({
  value,
  label,
  maxLength = 40,
  onDone,
}: {
  value: string;
  label: string;
  maxLength?: number;
  onDone: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      cancelled.current = true;
      event.currentTarget.blur();
    }
  };

  return (
    <input
      ref={inputRef}
      className="inline-rename-input"
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        const next = draft.trim();
        onDone(!cancelled.current && next && next !== value ? next : null);
      }}
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
    />
  );
}

export function RenamePencil({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-rename-btn"
      aria-label={label}
      title={label}
      tabIndex={-1}
      onPointerDown={stop}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

/** Label + pencil that turns into a `RenameInput` (pencil click or double-click). */
export function InlineRename({
  value,
  label,
  textStyle,
  onCommit,
  onFinish,
}: {
  value: string;
  label: string;
  textStyle?: CSSProperties;
  onCommit: (next: string) => void;
  /** Runs after editing ends, saved or not (e.g. to hand focus back). */
  onFinish?: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <RenameInput
        value={value}
        label={label}
        onDone={(next) => {
          setEditing(false);
          if (next) onCommit(next);
          onFinish?.();
        }}
      />
    );
  }

  return (
    <span className="inline-rename">
      <span
        style={textStyle}
        title={`${value} — double-click to rename`}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {value}
      </span>
      <RenamePencil label={label} onClick={() => setEditing(true)} />
    </span>
  );
}
