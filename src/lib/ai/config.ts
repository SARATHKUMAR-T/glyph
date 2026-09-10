import type { AICredentials, AIConfig, AIProviderType } from "./types";
import { AIConfigurationError } from "./types";

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: false,
  provider: "ollama",
  model: "",
  endpoint: "",
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 10000,
};

export const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1";

export const SUPPORTED_PROVIDERS: { id: AIProviderType; label: string; defaultEndpoint: string }[] = [
  { id: "ollama", label: "Ollama", defaultEndpoint: DEFAULT_OLLAMA_ENDPOINT },
  { id: "openai-compatible", label: "OpenAI Compatible", defaultEndpoint: DEFAULT_OPENAI_ENDPOINT },
];

/**
 * Resolves credentials from process environment variables if available.
 * Supports GLYPH_AI_API_KEY, TERMINAL_AI_API_KEY, and OPENAI_API_KEY.
 */
export function getEnvironmentCredentials(): AICredentials {
  let apiKey: string | undefined;

  // In Node/test or desktop environments where process.env might be present
  const globalObj = globalThis as { process?: { env?: Record<string, string | undefined> } };
  if (globalObj.process?.env) {
    apiKey =
      globalObj.process.env.GLYPH_AI_API_KEY ||
      globalObj.process.env.TERMINAL_AI_API_KEY ||
      globalObj.process.env.OPENAI_API_KEY;
  }

  // In Vite browser/webview environments with import.meta.env
  if (!apiKey && typeof import.meta !== "undefined" && import.meta.env) {
    const env = import.meta.env as Record<string, string | undefined>;
    apiKey =
      env.VITE_GLYPH_AI_API_KEY ||
      env.VITE_TERMINAL_AI_API_KEY ||
      env.VITE_OPENAI_API_KEY;
  }

  return {
    apiKey: apiKey?.trim() || undefined,
  };
}


/**
 * Validates the AI configuration and returns helpful error messages if invalid.
 */
export function validateAIConfig(config: AIConfig, credentials?: AICredentials): void {
  if (!config.enabled) {
    return;
  }

  const provider = config.provider?.trim().toLowerCase();
  if (!provider) {
    throw new AIConfigurationError("No AI provider configured.");
  }

  const isSupported = SUPPORTED_PROVIDERS.some((p) => p.id === provider);
  if (!isSupported) {
    const supportedList = SUPPORTED_PROVIDERS.map((p) => `- ${p.id}`).join("\n");
    throw new AIConfigurationError(
      `Unknown provider "${config.provider}".\n\nSupported providers:\n${supportedList}`,
    );
  }

  if (!config.model?.trim()) {
    throw new AIConfigurationError("No model configured.");
  }

  if (provider === "openai-compatible") {
    const creds = credentials ?? getEnvironmentCredentials();
    if (!creds.apiKey) {
      throw new AIConfigurationError(
        "API key is required for OpenAI-compatible provider.\nPlease set GLYPH_AI_API_KEY or TERMINAL_AI_API_KEY in your environment.",
      );
    }
  }
}

/**
 * Normalizes an endpoint URL (removes trailing slash, applies default if empty).
 */
export function normalizeEndpoint(endpoint: string | undefined, provider: string): string {
  const trimmed = endpoint?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }

  if (provider.toLowerCase() === "ollama") {
    return DEFAULT_OLLAMA_ENDPOINT;
  }
  if (provider.toLowerCase() === "openai-compatible") {
    return DEFAULT_OPENAI_ENDPOINT;
  }
  return "";
}
