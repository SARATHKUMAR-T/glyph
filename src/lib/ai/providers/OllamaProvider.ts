import type {
  AIProvider,
  AIProviderType,
  AIRequest,
  AIResponse,
  AIStreamChunk,
} from "../types";
import {
  AIProviderUnavailableError,
  AIRequestTimeoutError,
} from "../types";
import { DEFAULT_OLLAMA_ENDPOINT, normalizeEndpoint } from "../config";

export class OllamaProvider implements AIProvider {
  readonly name = "Ollama";
  readonly providerType: AIProviderType = "ollama";
  private readonly endpoint: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;

  constructor(options?: { endpoint?: string; model?: string; timeoutMs?: number }) {
    this.endpoint = normalizeEndpoint(options?.endpoint, "ollama") || DEFAULT_OLLAMA_ENDPOINT;
    this.defaultModel = options?.model?.trim() || "";
    this.defaultTimeoutMs = options?.timeoutMs ?? 10000;
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.defaultTimeoutMs, 5000));

    try {
      const res = await fetch(`${this.endpoint}/api/tags`, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return {
          available: false,
          reason: `Ollama returned HTTP status ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const models = data?.models || [];

      // If a model is configured, check if it's installed
      if (this.defaultModel) {
        const modelNames = models.map((m) => m.name || "");
        const hasModel = modelNames.some((n) => {
          return (
            n === this.defaultModel ||
            n === `${this.defaultModel}:latest` ||
            n.startsWith(`${this.defaultModel}:`)
          );
        });

        if (!hasModel && models.length > 0) {
          const availableList = modelNames.slice(0, 5).join(", ");
          return {
            available: false,
            reason: `Model "${this.defaultModel}" is not installed in Ollama. Available models: ${availableList || "none"}.\nRun: ollama pull ${this.defaultModel}`,
          };
        }
      }

      return { available: true };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        return {
          available: false,
          reason: `Connection to Ollama at ${this.endpoint} timed out.`,
        };
      }

      return {
        available: false,
        reason: `Could not connect to Ollama at ${this.endpoint}. Make sure Ollama is running.`,
      };
    }
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const model = request.model?.trim() || this.defaultModel;
    if (!model) {
      throw new AIProviderUnavailableError(
        "No model specified for Ollama request. Please configure a model name.",
      );
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
      model,
      prompt: request.prompt,
      system: request.systemPrompt,
      stream: false,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
      },
    };

    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (res.status === 404) {
          throw new AIProviderUnavailableError(
            `Model "${model}" was not found by Ollama. Please run: ollama pull ${model}`,
          );
        }
        throw new AIProviderUnavailableError(
          `Ollama request failed with status ${res.status}: ${errText || res.statusText}`,
        );
      }

      const data = (await res.json()) as {
        response?: string;
        model?: string;
        done_reason?: string;
      };

      return {
        text: data.response ?? "",
        model: data.model ?? model,
        finishReason: data.done_reason,
        raw: data,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof AIProviderUnavailableError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new AIRequestTimeoutError(
          `Ollama request timed out after ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      throw new AIProviderUnavailableError(
        `Failed to reach Ollama at ${this.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async stream(
    request: AIRequest,
    onChunk: (chunk: AIStreamChunk) => void,
  ): Promise<AIResponse> {
    const model = request.model?.trim() || this.defaultModel;
    if (!model) {
      throw new AIProviderUnavailableError("No model specified for Ollama stream request.");
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
      model,
      prompt: request.prompt,
      system: request.systemPrompt,
      stream: true,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
      },
    };

    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new AIProviderUnavailableError(
          `Ollama stream failed with status ${res.status}: ${errText || res.statusText}`,
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let lastModel = model;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.trim().length > 0);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as {
              response?: string;
              done?: boolean;
              model?: string;
            };
            if (parsed.model) lastModel = parsed.model;
            if (parsed.response) {
              fullText += parsed.response;
              onChunk({ delta: parsed.response, done: !!parsed.done });
            }
            if (parsed.done) {
              onChunk({ delta: "", done: true });
              break;
            }
          } catch {
            // Ignore partial lines
          }
        }
      }

      return {
        text: fullText,
        model: lastModel,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof AIProviderUnavailableError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new AIRequestTimeoutError(
          `Ollama streaming request timed out after ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      throw new AIProviderUnavailableError(
        `Failed to stream from Ollama: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
