import type { AICredentials, AIConfig, AIProvider } from "./types";
import { AIConfigurationError } from "./types";
import { OllamaProvider } from "./providers/OllamaProvider";
import { OpenAICompatibleProvider } from "./providers/OpenAICompatibleProvider";
import { getEnvironmentCredentials, SUPPORTED_PROVIDERS } from "./config";

export type ProviderFactoryFn = (
  config: AIConfig,
  credentials?: AICredentials,
) => AIProvider;

const registry = new Map<string, ProviderFactoryFn>();

// Register default built-in providers
registry.set("ollama", (config) => {
  return new OllamaProvider({
    endpoint: config.endpoint,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
});

registry.set("openai-compatible", (config, credentials) => {
  const creds = credentials ?? getEnvironmentCredentials();
  return new OpenAICompatibleProvider({
    endpoint: config.endpoint,
    model: config.model,
    timeoutMs: config.timeoutMs,
    credentials: creds,
  });
});

/**
 * Register a custom provider factory function for extensibility
 */
export function registerProvider(
  id: string,
  factory: ProviderFactoryFn,
): void {
  registry.set(id.toLowerCase(), factory);
}

/**
 * Creates an AIProvider instance from the given AI configuration.
 */
export function createProvider(
  config: AIConfig,
  credentials?: AICredentials,
): AIProvider {
  const providerKey = config.provider?.trim().toLowerCase();

  if (!providerKey) {
    throw new AIConfigurationError("No AI provider specified in configuration.");
  }

  const factory = registry.get(providerKey);
  if (!factory) {
    const supported = SUPPORTED_PROVIDERS.map((p) => `- ${p.id}`).join("\n");
    throw new AIConfigurationError(
      `Unknown provider "${config.provider}".\n\nSupported providers:\n${supported}`,
    );
  }

  return factory(config, credentials);
}
