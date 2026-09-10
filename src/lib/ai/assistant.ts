import { AIManager } from "./manager";

export type AICliContext = {
  cwd?: string;
  shell?: string;
  os?: string;
  lastCommand?: string;
  lastExitCode?: number;
  manager?: AIManager;
};

export type AIGeneratedCommand = {
  command: string;
  explanation: string;
  rawText: string;
};

export type AIDiagnosisResult = {
  diagnosis: string;
  suggestedFix?: string;
  rawText: string;
};

const SYSTEM_COMMAND_PROMPT = `You are Glyph AI, an expert Linux and Unix terminal assistant.
Your goal is to convert natural language requests into precise, safe, and effective shell commands.

CRITICAL INSTRUCTIONS:
1. Output the primary executable command on a line starting with "COMMAND: <command>"
2. Provide a short 1-2 sentence explanation on a line starting with "EXPLANATION: <explanation>"
3. Do not include markdown code block backticks inside the COMMAND line.
4. If multiple commands are needed, chain them with && or write a clean one-liner.
5. If the request is ambiguous or potentially destructive (like rm -rf /), choose the safest sensible variant.

Example output format:
COMMAND: tar -czvf archive.tar.gz /path/to/folder
EXPLANATION: Creates a gzip-compressed tar archive named archive.tar.gz from the specified directory.`;

const SYSTEM_DIAGNOSIS_PROMPT = `You are Glyph AI, an expert Linux terminal debugger.
A command just failed in the user's terminal with a non-zero exit code.
Explain concisely why the command failed and provide the exact fix command.

Format your response strictly as:
DIAGNOSIS: <1-2 sentences explaining why the error occurred>
FIX: <the exact command to fix or resolve the problem>`;

/**
 * Extracts COMMAND and EXPLANATION lines from the AI model's response.
 */
export function parseGeneratedCommand(text: string): AIGeneratedCommand {
  const trimmed = text.trim();
  let command = "";
  let explanation = "";

  const lines = trimmed.split("\n");
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith("COMMAND:")) {
      command = l.replace(/^COMMAND:\s*/, "").trim();
    } else if (l.startsWith("EXPLANATION:")) {
      explanation = l.replace(/^EXPLANATION:\s*/, "").trim();
    }
  }

  // Fallback parsing if model did not follow exact format:
  if (!command) {
    // Check for fenced code blocks
    const codeBlockMatch = trimmed.match(/```(?:bash|sh|zsh)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      command = codeBlockMatch[1].trim().split("\n")[0].trim();
      explanation = trimmed.replace(codeBlockMatch[0], "").trim();
    } else {
      // First non-empty line as command
      const firstLine = lines.find((line) => line.trim().length > 0 && !line.startsWith("#")) || "";
      command = firstLine.trim().replace(/^`+|`+$/g, "");
      explanation = lines.slice(1).join(" ").trim();
    }
  }

  // Clean markdown backticks or quotes if left
  command = command.replace(/^`+|`+$/g, "").trim();

  if (!explanation) {
    explanation = "Generated shell command.";
  }

  return {
    command,
    explanation,
    rawText: trimmed,
  };
}

/**
 * Extracts DIAGNOSIS and FIX from the diagnosis response.
 */
export function parseDiagnosis(text: string): AIDiagnosisResult {
  const trimmed = text.trim();
  let diagnosis = "";
  let suggestedFix = "";

  const lines = trimmed.split("\n");
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith("DIAGNOSIS:")) {
      diagnosis = l.replace(/^DIAGNOSIS:\s*/, "").trim();
    } else if (l.startsWith("FIX:")) {
      suggestedFix = l.replace(/^FIX:\s*/, "").trim();
    }
  }

  // Fallback if no explicit FIX: was provided, check for codeblock
  if (!suggestedFix) {
    const codeBlockMatch = trimmed.match(/```(?:bash|sh|zsh)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      suggestedFix = codeBlockMatch[1].trim();
    }
  }

  if (!diagnosis) {
    diagnosis = trimmed;
  }

  // Clean suggested fix
  suggestedFix = suggestedFix.replace(/^`+|`+$/g, "").trim();

  return {
    diagnosis,
    suggestedFix: suggestedFix || undefined,
    rawText: trimmed,
  };
}

/**
 * Generates a shell command from natural language.
 */
export async function generateCommandFromNaturalLanguage(
  prompt: string,
  context?: AICliContext,
): Promise<AIGeneratedCommand> {
  const aiManager = context?.manager || AIManager.getInstance();

  let userPrompt = `Request: "${prompt}"`;
  if (context?.cwd) {
    userPrompt += `\nCurrent Working Directory: ${context.cwd}`;
  }
  if (context?.shell) {
    userPrompt += `\nShell: ${context.shell}`;
  }
  if (context?.os) {
    userPrompt += `\nOS / Platform: ${context.os}`;
  }

  const response = await aiManager.complete({
    systemPrompt: SYSTEM_COMMAND_PROMPT,
    prompt: userPrompt,
    temperature: 0.2,
    maxTokens: 512,
  });

  return parseGeneratedCommand(response.text);
}

/**
 * Diagnoses a failed command.
 */
export async function diagnoseCommand(
  command: string,
  exitCode: number,
  outputSnippet?: string,
  context?: AICliContext,
): Promise<AIDiagnosisResult> {
  const aiManager = context?.manager || AIManager.getInstance();

  let prompt = `Failed command: ${command}\nExit code: ${exitCode}`;
  if (outputSnippet) {
    prompt += `\nError output:\n${outputSnippet.slice(-1000)}`;
  }
  if (context?.cwd) {
    prompt += `\nCurrent Working Directory: ${context.cwd}`;
  }
  if (context?.os) {
    prompt += `\nOS / Platform: ${context.os}`;
  }

  const response = await aiManager.complete({
    systemPrompt: SYSTEM_DIAGNOSIS_PROMPT,
    prompt,
    temperature: 0.2,
    maxTokens: 512,
  });

  return parseDiagnosis(response.text);
}

