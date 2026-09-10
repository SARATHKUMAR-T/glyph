import type { AIManager } from "./manager";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  accent: "\x1b[38;2;255;48;48m",
  muted: "\x1b[38;2;160;160;160m",
  text: "\x1b[38;2;220;220;220m",
};

export async function handleAIStatusCommand(
  aiManager: AIManager,
  writeLine: (line: string) => void,
): Promise<void> {
  const status = await aiManager.getStatus();

  writeLine(`${ANSI.bold}AI Status${ANSI.reset}`);
  writeLine(`${ANSI.dim}────────────────────────${ANSI.reset}`);
  writeLine("");

  if (!status.enabled) {
    writeLine(`${ANSI.muted}Enabled:   ${ANSI.reset}no`);
    writeLine("");
    writeLine(`${ANSI.dim}To enable AI, open Terminal Settings or configure [ai] section.${ANSI.reset}`);
    writeLine("");
    return;
  }

  writeLine(`${ANSI.muted}Enabled:   ${ANSI.reset}yes`);
  writeLine(`${ANSI.muted}Provider:  ${ANSI.reset}${status.provider}`);
  writeLine(`${ANSI.muted}Model:     ${ANSI.reset}${status.model || "(none)"}`);
  writeLine(`${ANSI.muted}Endpoint:  ${ANSI.reset}${status.endpoint || "(none)"}`);

  let statusColor = ANSI.green;
  if (status.status === "Unavailable" || status.status === "Misconfigured") {
    statusColor = ANSI.red;
  } else if (status.status === "Disabled") {
    statusColor = ANSI.yellow;
  }

  writeLine(`${ANSI.muted}Status:    ${statusColor}${status.status}${ANSI.reset}`);

  if (status.reason) {
    writeLine("");
    writeLine(`${ANSI.bold}Reason:${ANSI.reset}`);
    const reasonLines = status.reason.split("\n");
    for (const rLine of reasonLines) {
      writeLine(`${ANSI.text}${rLine}${ANSI.reset}`);
    }
  }

  writeLine("");
}

export async function handleAITestCommand(
  aiManager: AIManager,
  writeLine: (line: string) => void,
): Promise<void> {
  writeLine(`${ANSI.bold}Testing AI provider...${ANSI.reset}`);
  writeLine("");

  const testResult = await aiManager.test();

  for (const step of testResult.steps) {
    if (step.passed) {
      const extra = step.message ? ` ${ANSI.dim}(${step.message})${ANSI.reset}` : "";
      writeLine(`  ${ANSI.green}✓${ANSI.reset} ${step.name}${extra}`);
    } else {
      const extra = step.message ? ` ${ANSI.red}(${step.message})${ANSI.reset}` : "";
      writeLine(`  ${ANSI.red}✗${ANSI.reset} ${step.name}${extra}`);
    }
  }

  writeLine("");
  if (testResult.success) {
    writeLine(`${ANSI.green}${ANSI.bold}AI is ready.${ANSI.reset}`);
  } else {
    writeLine(`${ANSI.red}${ANSI.bold}AI test failed.${ANSI.reset}`);
    if (testResult.error && !testResult.steps.some((s) => s.message === testResult.error)) {
      writeLine(`${ANSI.muted}${testResult.error}${ANSI.reset}`);
    }
  }
  writeLine("");
}

export function handleAIHelpCommand(writeLine: (line: string) => void): void {
  writeLine(`${ANSI.bold}Glyph AI CLI Commands${ANSI.reset}`);
  writeLine(`${ANSI.dim}────────────────────────${ANSI.reset}`);
  writeLine(`  ${ANSI.accent}ai status${ANSI.reset}    Inspect current AI provider connection and configuration`);
  writeLine(`  ${ANSI.accent}ai test${ANSI.reset}      Test AI connectivity and run a verification completion`);
  writeLine(`  ${ANSI.accent}ai help${ANSI.reset}      Show this help message`);
  writeLine("");
  writeLine(`${ANSI.dim}Supported providers: ollama, openai-compatible${ANSI.reset}`);
  writeLine("");
}
