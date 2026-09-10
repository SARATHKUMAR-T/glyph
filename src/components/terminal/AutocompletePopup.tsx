import React from "react";
import type { CandidateType, CompletionCandidate } from "../../lib/autocomplete/types.js";

type AutocompletePopupProps = {
  candidates: CompletionCandidate[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onAcceptCandidate: (candidate: CompletionCandidate) => void;
  position: { top: number; left: number; renderAbove?: boolean; maxHeight?: number };
  visible: boolean;
};

function getBadgeLabel(type: CandidateType): { label: string; colorClass: string } {
  switch (type) {
    case "command":
      return { label: "cmd", colorClass: "badge-cmd" };
    case "subcommand":
      return { label: "sub", colorClass: "badge-sub" };
    case "directory":
      return { label: "dir", colorClass: "badge-dir" };
    case "file":
      return { label: "file", colorClass: "badge-file" };
    case "branch":
      return { label: "branch", colorClass: "badge-branch" };
    case "history":
      return { label: "hist", colorClass: "badge-hist" };
    case "project-script":
      return { label: "script", colorClass: "badge-script" };
    case "option":
      return { label: "opt", colorClass: "badge-opt" };
    default:
      return { label: "item", colorClass: "badge-cmd" };
  }
}

function renderHighlightedText(text: string, matchedIndices?: number[]) {
  if (!matchedIndices || matchedIndices.length === 0) {
    return <span>{text}</span>;
  }

  const matchSet = new Set(matchedIndices);
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (matchSet.has(i)) {
      elements.push(
        <span key={i} className="autocomplete-match-char">
          {char}
        </span>
      );
    } else {
      elements.push(char);
    }
  }

  return <>{elements}</>;
}

export function AutocompletePopup({
  candidates,
  selectedIndex,
  onSelectIndex,
  onAcceptCandidate,
  position,
  visible,
}: AutocompletePopupProps) {
  if (!visible || candidates.length === 0) {
    return null;
  }

  const { top, left, renderAbove, maxHeight } = position;

  return (
    <div
      className={`terminal-autocomplete-popup ${renderAbove ? "is-above" : ""}`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="autocomplete-candidate-list"
        role="listbox"
        style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {candidates.map((candidate, idx) => {
          const isSelected = idx === selectedIndex;
          const badge = getBadgeLabel(candidate.type);

          return (
            <div
              key={`${candidate.type}-${candidate.text}-${idx}`}
              className={`autocomplete-candidate-item ${isSelected ? "is-selected" : ""}`}
              onMouseEnter={() => onSelectIndex(idx)}
              onClick={() => onAcceptCandidate(candidate)}
              role="option"
              aria-selected={isSelected}
            >
              <div className="autocomplete-item-left">
                <span className={`autocomplete-type-badge ${badge.colorClass}`}>
                  {badge.label}
                </span>
                <span className="autocomplete-item-text">
                  {renderHighlightedText(candidate.displayText || candidate.text, candidate.matchedIndices)}
                </span>
              </div>

              {candidate.description && (
                <span className="autocomplete-item-desc">
                  {candidate.description}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="autocomplete-popup-footer">
        <span className="autocomplete-key-hint">
          <kbd>Tab</kbd> Accept
        </span>
        <span className="autocomplete-key-hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span className="autocomplete-key-hint">
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </div>
  );
}
