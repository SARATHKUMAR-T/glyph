import type {
  AICredentials,
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
import { DEFAULT_OPENAI_ENDPOINT, normalizeEndpoint } from "../config";

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "OpenAI Compatible";
  readonly providerType: AIProviderType = "openai-compatible";
  private readonly endpoint: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;
  private readonly credentials?: AICredentials;

  constructor(options?: {
    endpoint?: string;
    model?: string;
    timeoutMs?: number;
    credentials?: AICredentials;
  }) {
    this.endpoint =
      normalizeEndpoint(options?.endpoint, "openai-compatible") || DEFAULT_OPENAI_ENDPOINT;
    this.defaultModel = options?.model?.trim() || "";
    this.defaultTimeoutMs = options?.timeoutMs ?? 10000;
    this.credentials = options?.credentials;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.credentials?.apiKey) {
      headers["Authorization"] = `Bearer ${this.credentials.apiKey}`;
    }

    return headers;
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    if (!this.credentials?.apiKey) {
      return {
        available: false,
        reason:
          "No API key provided. Set the GLYPH_AI_API_KEY or TERMINAL_AI_API_KEY environment variable.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.defaultTimeoutMs, 5000));

    try {
      // Test connectivity by querying /models
      const res = await fetch(`${this.endpoint}/models`, {
        method: "GET",
        headers: this.getAuthHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 401 || res.status === 403) {
        return {
          available: false,
          reason: "Authentication failed. The provided API key is invalid or unauthorized.",
        };
      }

      if (!res.ok) {
        // Some OpenAI-compatible gateways might not implement /models; if they returned 404 on /models but endpoint is alive
        if (res.status === 404) {
          return { available: true };
        }
        return {
          available: false,
          reason: `Endpoint returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      return { available: true };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        return {
          available: false,
          reason: `Connection to endpoint ${this.endpoint} timed out.`,
        };
      }

      return {
        available: false,
        reason: `Could not reach endpoint at ${this.endpoint}. Please verify network connectivity and URL.`,
      };
    }
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const model = request.model?.trim() || this.defaultModel;
    if (!model) {
      throw new AIProviderUnavailableError(
        "No model configured for OpenAI-compatible provider. Please specify a model name.",
      );
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.prompt });

    const payload = {
      model,
      messages,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };

    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        let errorMsg = res.statusText;
        try {
          const parsed = JSON.parse(errBody) as { error?: { message?: string } };
          if (parsed.error?.message) {
            errorMsg = parsed.error.message;
          }
        } catch {
          if (errBody) errorMsg = errBody;
        }

        if (res.status === 401) {
          throw new AIProviderUnavailableError(
            `Authentication error (401): ${errorMsg || "Invalid API key"}`,
          );
        }
        if (res.status === 404) {
          throw new AIProviderUnavailableError(
            `Resource not found (404): Model "${model}" or endpoint "${this.endpoint}" is invalid.`,
          );
        }
        if (res.status === 429) {
          throw new AIProviderUnavailableError(`Rate limit exceeded (429): ${errorMsg}`);
        }

        throw new AIProviderUnavailableError(
          `OpenAI-compatible request failed (${res.status}): ${errorMsg}`,
        );
      }

      const data = (await res.json()) as {
        id?: string;
        model?: string;
        choices?: Array<{
          message?: { content?: string };
          finish_reason?: string;
        }>;
      };

      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? "";

      return {
        text,
        model: data.model ?? model,
        finishReason: choice?.finish_reason,
        raw: data,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof AIProviderUnavailableError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new AIRequestTimeoutError(
          `OpenAI-compatible request timed out after ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      throw new AIProviderUnavailableError(
        `Failed to reach OpenAI-compatible endpoint at ${this.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
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
      throw new AIProviderUnavailableError("No model specified for stream request.");
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.prompt });

    const payload = {
      model,
      messages,
      stream: true,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };

    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new AIProviderUnavailableError(
          `OpenAI stream failed with status ${res.status}: ${errText || res.statusText}`,
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let lastModel = model;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split("\n");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataContent = trimmed.slice(5).trim();
          if (dataContent === "[DONE]") {
            onChunk({ delta: "", done: true });
            break;
          }

          try {
            const parsed = JSON.parse(dataContent) as {
              model?: string;
              choices?: Array<{ delta?: { content?: string } }>;
            };
            if (parsed.model) lastModel = parsed.model;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk({ delta, done: false });
            }
          } catch {
            // Ignore incomplete chunks
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
          `Streaming request timed out after ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      throw new AIProviderUnavailableError(
        `Failed to stream from endpoint: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
