type TerminalInputProps = {
  disabled?: boolean;
};

export function TerminalInput({ disabled = true }: TerminalInputProps) {
  return (
    <div className="terminal-input" aria-hidden="true" data-disabled={disabled}>
      <span>$</span>
    </div>
  );
}
