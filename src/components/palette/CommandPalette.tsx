import { useEffect, useMemo, useRef, useState } from "react";

export type PaletteCommand = {
  id: string;
  label: string;
  group?: string;
  shortcut?: string;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
};

/** Ranks a command against the query by plain substring position (earlier
 * match wins) rather than a fuzzy-subsequence scorer — the action list is
 * small (a couple dozen entries) and every label is a short, predictable
 * phrase, so a fuzzy matcher would mostly add false-positive noise instead
 * of finding anything a substring search wouldn't. */
function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands
    .map((cmd) => ({ cmd, idx: cmd.label.toLowerCase().indexOf(q) }))
    .filter((entry) => entry.idx !== -1)
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => entry.cmd);
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const runActive = () => {
    const cmd = filtered[activeIndex];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runActive();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="command-palette-list" role="listbox">
          {filtered.length === 0 && <li className="command-palette-empty">No matching commands</li>}
          {filtered.map((cmd, i) => (
            <li
              key={cmd.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="option"
              aria-selected={i === activeIndex}
              className={`command-palette-item${i === activeIndex ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => {
                onClose();
                cmd.run();
              }}
            >
              <span className="command-palette-item-label">{cmd.label}</span>
              {cmd.shortcut && <span className="command-palette-item-shortcut">{cmd.shortcut}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
