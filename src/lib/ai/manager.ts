import type {
  AICredentials,
  AIConfig,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStatusResult,
  AIStreamChunk,
  AITestResult,
  AITestStep,
} from "./types";
import {
  AIConfigurationError,
  AIProviderUnavailableError,
} from "./types";
import { DEFAULT_AI_CONFIG, getEnvironmentCredentials, normalizeEndpoint, validateAIConfig } from "./config";
import { createProvider } from "./factory";

export class AIManager {
  private config: AIConfig;
  private credentials?: AICredentials;
  private currentProvider: AIProvider | null = null;
  private static instance: AIManager | null = null;

  constructor(initialConfig?: Partial<AIConfig>, credentials?: AICredentials) {
    this.config = { ...DEFAULT_AI_CONFIG, ...initialConfig };
    this.credentials = credentials ?? getEnvironmentCredentials();
    this.initProvider();
  }

  static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager();
    }
    return AIManager.instance;
  }

  /**
   * Safe debug logger that never exposes keys or sensitive prompts
   */
  private logDebug(message: string, meta?: Record<string, unknown>) {
    const globalObj = globalThis as { process?: { env?: Record<string, string | undefined> } };
    if (globalObj.process?.env?.NODE_ENV === "test") {
      return;
    }
    // Filter any key-like properties from meta

    const safeMeta: Record<string, unknown> = {};
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (!/key|secret|token|password|auth/i.test(k)) {
          safeMeta[k] = v;
        }
      }
    }
    console.debug(`[GLYPH AI] ${message}`, Object.keys(safeMeta).length > 0 ? safeMeta : "");
  }

  private initProvider(): void {
    if (!this.config.enabled) {
      this.currentProvider = null;
      return;
    }

    try {
      this.currentProvider = createProvider(this.config, this.credentials);
      this.logDebug("AI provider initialized", {
        provider: this.currentProvider.name,
        model: this.config.model,
        endpoint: normalizeEndpoint(this.config.endpoint, this.config.provider),
      });
    } catch (err: unknown) {
      this.currentProvider = null;
      this.logDebug("AI provider initialization deferred or failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  updateConfig(patch: Partial<AIConfig>, credentials?: AICredentials): void {
    this.config = { ...this.config, ...patch };
    if (credentials) {
      this.credentials = credentials;
    } else if (!this.credentials) {
      this.credentials = getEnvironmentCredentials();
    }
    this.initProvider();
  }

  getConfig(): Readonly<AIConfig> {
    return { ...this.config };
  }

  getProvider(): AIProvider | null {
    return this.currentProvider;
  }

  async getStatus(): Promise<AIStatusResult> {
    if (!this.config.enabled) {
      return {
        enabled: false,
        provider: this.config.provider || "none",
        model: this.config.model || "none",
        endpoint: normalizeEndpoint(this.config.endpoint, this.config.provider) || "none",
        status: "Disabled",
      };
    }

    const endpoint = normalizeEndpoint(this.config.endpoint, this.config.provider);
    const providerName = this.config.provider === "ollama" ? "Ollama" : "OpenAI Compatible";

    // Validate configuration
    try {
      validateAIConfig(this.config, this.credentials);
    } catch (err: unknown) {
      return {
        enabled: true,
        provider: providerName,
        model: this.config.model || "none",
        endpoint: endpoint || "none",
        status: "Misconfigured",
        reason: err instanceof Error ? err.message : String(err),
        hasApiKey: Boolean(this.credentials?.apiKey),
      };
    }

    try {
      const provider = this.currentProvider ?? createProvider(this.config, this.credentials);
      const avail = await provider.isAvailable();

      if (avail.available) {
        return {
          enabled: true,
          provider: provider.name,
          model: this.config.model,
          endpoint,
          status: "Connected",
          hasApiKey: Boolean(this.credentials?.apiKey),
        };
      }

      return {
        enabled: true,
        provider: provider.name,
        model: this.config.model,
        endpoint,
        status: "Unavailable",
        reason: avail.reason || "Provider is currently unreachable.",
        hasApiKey: Boolean(this.credentials?.apiKey),
      };
    } catch (err: unknown) {
      return {
        enabled: true,
        provider: providerName,
        model: this.config.model,
        endpoint,
        status: "Unavailable",
        reason: err instanceof Error ? err.message : String(err),
        hasApiKey: Boolean(this.credentials?.apiKey),
      };
    }
  }

  async test(): Promise<AITestResult> {
    const steps: AITestStep[] = [];

    // Step 1: Configuration loaded
    steps.push({
      name: "Configuration loaded",
      passed: true,
    });

    if (!this.config.enabled) {
      return {
        success: false,
        steps,
        error: "AI is currently disabled. Enable AI in settings or with 'glyph ai config' first.",
      };
    }

    // Step 2: Validate configuration & provider initialization
    try {
      validateAIConfig(this.config, this.credentials);
      const provider = this.currentProvider ?? createProvider(this.config, this.credentials);
      steps.push({
        name: `Provider initialized (${provider.name})`,
        passed: true,
      });

      // Step 3: Check endpoint reachability & model availability
      const avail = await provider.isAvailable();
      if (!avail.available) {
        steps.push({
          name: "Endpoint / Model reachability",
          passed: false,
          message: avail.reason,
        });
        return {
          success: false,
          steps,
          error: avail.reason,
        };
      }

      steps.push({
        name: "Endpoint reachable & model available",
        passed: true,
      });

      // Step 4: Small test completion
      const testPrompt = "Respond with exactly the word 'OK'.";
      const response = await provider.complete({
        prompt: testPrompt,
        maxTokens: 10,
        temperature: 0.0,
      });

      steps.push({
        name: "Test completion successful",
        passed: true,
        message: response.text.trim() ? `Received response from ${response.model ?? this.config.model}` : undefined,
      });

      return {
        success: true,
        steps,
        response,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      steps.push({
        name: "AI operation",
        passed: false,
        message: errorMsg,
      });
      return {
        success: false,
        steps,
        error: errorMsg,
      };
    }
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    if (!this.config.enabled) {
      throw new AIProviderUnavailableError(
        "AI features are disabled. Please enable AI in terminal settings.",
      );
    }

    validateAIConfig(this.config, this.credentials);

    if (!this.currentProvider) {
      this.initProvider();
    }

    if (!this.currentProvider) {
      throw new AIProviderUnavailableError("AI provider is not initialized.");
    }

    return this.currentProvider.complete(request);
  }

  async stream(
    request: AIRequest,
    onChunk: (chunk: AIStreamChunk) => void,
  ): Promise<AIResponse> {
    if (!this.config.enabled) {
      throw new AIProviderUnavailableError("AI features are disabled.");
    }

    validateAIConfig(this.config, this.credentials);

    if (!this.currentProvider) {
      this.initProvider();
    }

    if (!this.currentProvider) {
      throw new AIProviderUnavailableError("AI provider is not initialized.");
    }

    if (this.currentProvider.stream) {
      return this.currentProvider.stream(request, onChunk);
    }

    // Fallback if provider doesn't support streaming
    const response = await this.currentProvider.complete(request);
    onChunk({ delta: response.text, done: true });
    return response;
  }
}
