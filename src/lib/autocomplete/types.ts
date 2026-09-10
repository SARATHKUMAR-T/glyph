export type CandidateType =
  | "command"
  | "subcommand"
  | "file"
  | "directory"
  | "branch"
  | "history"
  | "project-script"
  | "option";

export type CompletionCandidate = {
  text: string;
  displayText?: string;
  description?: string;
  type: CandidateType;
  source: string;
  score?: number;
  replacementStart: number;
  replacementEnd: number;
  matchedIndices?: number[];
};

export type CompletionContext = {
  input: string;
  cursorPosition: number;
  cwd?: string;
  shell?: string;
  history?: string[];
};

export type ParsedToken = {
  raw: string;
  clean: string;
  start: number;
  end: number;
  isQuoteClosed: boolean;
  quoteChar?: string;
};

export type ParsedCommandContext = {
  command: string;
  subcommand?: string;
  tokens: ParsedToken[];
  activeToken: ParsedToken;
  activeTokenIndex: number;
  isInitialCommand: boolean;
  isFlag: boolean;
  isPathLike: boolean;
};

export interface CompletionProvider {
  id: string;
  name: string;
  priority: number;
  complete: (
    context: CompletionContext,
    parsed: ParsedCommandContext
  ) => Promise<CompletionCandidate[]> | CompletionCandidate[];
}

export type CompletionResult = {
  requestId: number;
  input: string;
  cursorPosition: number;
  candidates: CompletionCandidate[];
  selectedIndex: number;
};
