import type { ReactNode } from "react";

import type { ConnectionLossAction } from "../../lib/workspace/types";

const OPTIONS: { value: ConnectionLossAction; label: string; description: string; icon: ReactNode }[] = [
  {
    value: "off",
    label: "Off",
    description: "Nothing happens if the command loses its connection.",
    icon: <circle cx="12" cy="12" r="8" />,
  },
  {
    value: "warn",
    label: "Warn",
    description: "Shows a warning at the top of the pane with a Restart button.",
    icon: (
      <>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
  },
  {
    value: "restart",
    label: "Auto-restart",
    description: "Re-runs the command by itself once the network is back, retrying if it fails.",
    icon: (
      <>
        <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
  },
];

type ConnectionLossSelectProps = {
  value: ConnectionLossAction | undefined;
  onChange: (value: ConnectionLossAction) => void;
  /** Whether the pane has a startup command — there's nothing to watch
   * without one. */
  hasCommand: boolean;
};

/** A workspace pane's "If the Connection Drops" option, shared by the
 * create, save and edit dialogs — see `useConnectionWatch`. A segmented
 * control, so all three choices are visible at once, with the selected
 * one explained underneath. */
export function ConnectionLossSelect({ value = "off", onChange, hasCommand }: ConnectionLossSelectProps) {
  const selected = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  return (
    <div className={`connection-loss-field${hasCommand ? "" : " is-inactive"}`}>
      <span className="pane-field-label">If the Connection Drops</span>
      <div className="segmented" role="radiogroup" aria-label="If the connection drops">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className={`segmented-option is-${option.value}${option.value === value ? " is-selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {option.icon}
            </svg>
            {option.label}
          </button>
        ))}
      </div>
      <span className="connection-loss-hint">
        {hasCommand ? selected.description : "Add a startup command above to use this."}
      </span>
    </div>
  );
}
