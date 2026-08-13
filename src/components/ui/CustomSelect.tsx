import { useEffect, useRef, useState } from "react";

export type CustomOption<T extends string | number> = {
  label: string;
  value: T;
};

type CustomSelectProps<T extends string | number> = {
  value: T;
  options: CustomOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  direction?: "auto" | "up" | "down";
};

export function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  className = "",
  direction = "auto",
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  const handleToggle = () => {
    if (!open && containerRef.current) {
      if (direction === "up") {
        setDropUp(true);
      } else if (direction === "down") {
        setDropUp(false);
      } else {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setDropUp(spaceBelow < 240);
      }
    }
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`custom-select-container ${className}`}>
      <button
        type="button"
        className={open ? "custom-select-trigger is-open" : "custom-select-trigger"}
        onClick={handleToggle}
      >
        <span className="custom-select-value-text">{selectedOption?.label}</span>
        <svg
          className={open ? "custom-select-arrow is-open" : "custom-select-arrow"}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className={dropUp ? "custom-select-dropdown is-up" : "custom-select-dropdown"} role="listbox">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={isSelected ? "custom-select-item is-selected" : "custom-select-item"}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {isSelected && <span className="custom-select-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
