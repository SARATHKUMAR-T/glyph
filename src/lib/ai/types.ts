/**
 * AI Provider Foundation Types for Glyph Terminal
 */

export type AIProviderType = "ollama" | "openai-compatible";

export type AIConfig = {
  enabled: boolean;
  provider: AIProviderType | string;
  model: string;
  endpoint: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type AICredentials = {
  apiKey?: string;
};

export type AIRequest = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type AIResponse = {
  text: string;
  model?: string;
  finishReason?: string;
  raw?: unknown;
};

export type AIStreamChunk = {
  delta: string;
  done: boolean;
};

export type AIStatusResult = {
  enabled: boolean;
  provider: string;
  model: string;
  endpoint: string;
  status: "Connected" | "Unavailable" | "Disabled" | "Misconfigured";
  reason?: string;
  hasApiKey?: boolean;
};

export type AITestStep = {
  name: string;
  passed: boolean;
  message?: string;
};

export type AITestResult = {
  success: boolean;
  steps: AITestStep[];
  response?: AIResponse;
  error?: string;
};

export interface AIProvider {
  readonly name: string;
  readonly providerType: AIProviderType | string;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  complete(request: AIRequest): Promise<AIResponse>;
  stream?(request: AIRequest, onChunk: (chunk: AIStreamChunk) => void): Promise<AIResponse>;
}

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

export class AIProviderUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AIProviderUnavailableError";
  }
}

export class AIRequestTimeoutError extends Error {
  constructor(message = "AI request timed out.") {
    super(message);
    this.name = "AIRequestTimeoutError";
  }
}
