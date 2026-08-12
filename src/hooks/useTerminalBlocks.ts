import { useCallback, useState } from "react";

import type { TerminalBlock, TerminalSemanticEvent } from "../lib/terminal/types";

function createBlockId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function reduceBlocks(blocks: TerminalBlock[], event: TerminalSemanticEvent): TerminalBlock[] {
  if (event.kind === "command_execution_start") {
    return [
      ...blocks,
      {
        id: createBlockId(),
        sessionId: event.sessionId,
        status: "running",
        startedAt: event.timestamp,
      },
    ];
  }

  if (event.kind !== "command_finished") {
    return blocks;
  }

  const lastRunningIndex = [...blocks].reverse().findIndex((block) => block.status === "running");
  const finishedAt = event.timestamp;
  const status = event.exitCode === 0 ? "success" : "error";

  if (lastRunningIndex === -1) {
    return [
      ...blocks,
      {
        id: createBlockId(),
        sessionId: event.sessionId,
        status,
        exitCode: event.exitCode,
        startedAt: finishedAt,
        finishedAt,
      },
    ];
  }

  const targetIndex = blocks.length - 1 - lastRunningIndex;
  return blocks.map((block, index) =>
    index === targetIndex
      ? {
          ...block,
          status,
          exitCode: event.exitCode,
          finishedAt,
        }
      : block,
  );
}

export function useTerminalBlocks() {
  const [blocksByTab, setBlocksByTab] = useState<Record<string, TerminalBlock[]>>({});

  const ingestSemanticEvent = useCallback((clientId: string, event: TerminalSemanticEvent) => {
    setBlocksByTab((current) => ({
      ...current,
      [clientId]: reduceBlocks(current[clientId] ?? [], event).slice(-48),
    }));
  }, []);

  const clearBlocks = useCallback((clientId: string) => {
    setBlocksByTab((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
  }, []);

  return { blocksByTab, clearBlocks, ingestSemanticEvent };
}
