import type {
  CompletionCandidate,
  CompletionContext,
  CompletionProvider,
  CompletionResult,
} from "./types.js";
import { tokenizeCommandLine } from "./tokenizer.js";
import { rankAndDeduplicateCandidates } from "./ranking.js";
import { CommandProvider } from "./providers/CommandProvider.js";
import { FilesystemProvider } from "./providers/FilesystemProvider.js";
import { ShellProvider } from "./providers/ShellProvider.js";
import { GitProvider } from "./providers/GitProvider.js";
import { HistoryProvider } from "./providers/HistoryProvider.js";
import { ProjectProvider } from "./providers/ProjectProvider.js";

export class CompletionEngine {
  private static instance: CompletionEngine | null = null;
  private providers: CompletionProvider[] = [];
  private currentRequestId = 0;

  private constructor() {
    // Register local providers
    this.registerProvider(new CommandProvider());
    this.registerProvider(new FilesystemProvider());
    this.registerProvider(new ShellProvider());
    this.registerProvider(new GitProvider());
    this.registerProvider(new HistoryProvider());
    this.registerProvider(new ProjectProvider());
  }

  public static getInstance(): CompletionEngine {
    if (!CompletionEngine.instance) {
      CompletionEngine.instance = new CompletionEngine();
    }
    return CompletionEngine.instance;
  }

  public registerProvider(provider: CompletionProvider): void {
    // Avoid duplicate IDs
    this.providers = this.providers.filter((p) => p.id !== provider.id);
    this.providers.push(provider);
    this.providers.sort((a, b) => b.priority - a.priority);
  }

  public getProviders(): CompletionProvider[] {
    return [...this.providers];
  }

  /**
   * Generates completion candidates for the given context.
   * Protects against stale out-of-order async responses.
   */
  public async getCompletions(
    context: CompletionContext,
    maxResults = 7
  ): Promise<CompletionResult | null> {
    const requestId = ++this.currentRequestId;
    const input = context.input;
    const cursor = context.cursorPosition;

    if (!input && cursor === 0) {
      return {
        requestId,
        input,
        cursorPosition: cursor,
        candidates: [],
        selectedIndex: 0,
      };
    }

    const parsed = tokenizeCommandLine(input, cursor);

    // Query all providers concurrently
    const promises = this.providers.map(async (provider) => {
      try {
        const res = await provider.complete(context, parsed);
        return Array.isArray(res) ? res : [];
      } catch (err) {
        console.warn(`[Autocomplete] Provider "${provider.name}" error:`, err);
        return [];
      }
    });

    const settled = await Promise.allSettled(promises);

    // Stale check: if a newer request was dispatched while waiting, discard this result
    if (requestId !== this.currentRequestId) {
      return null;
    }

    const rawCandidates: CompletionCandidate[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        rawCandidates.push(...result.value);
      }
    }

    const ranked = rankAndDeduplicateCandidates(rawCandidates, maxResults);

    return {
      requestId,
      input,
      cursorPosition: cursor,
      candidates: ranked,
      selectedIndex: 0,
    };
  }
}
