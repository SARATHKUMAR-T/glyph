import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AI_CONFIG,
  validateAIConfig,
  getEnvironmentCredentials,
  normalizeEndpoint,
} from "../config";
import { createProvider, registerProvider } from "../factory";
import { OllamaProvider } from "../providers/OllamaProvider";
import { OpenAICompatibleProvider } from "../providers/OpenAICompatibleProvider";
import { AIManager } from "../manager";
import {
  AIConfigurationError,
  AIProviderUnavailableError,
  AIRequestTimeoutError,
} from "../types";
import { handleAIHelpCommand, handleAIStatusCommand, handleAITestCommand } from "../commands";

describe("AI Foundation - Configuration", () => {
  it("should have AI disabled by default", () => {
    assert.equal(DEFAULT_AI_CONFIG.enabled, false);
    assert.equal(DEFAULT_AI_CONFIG.provider, "ollama");
    assert.equal(DEFAULT_AI_CONFIG.model, "");
  });

  it("should validate valid Ollama configuration", () => {
    assert.doesNotThrow(() => {
      validateAIConfig({
        enabled: true,
        provider: "ollama",
        model: "qwen2.5-coder:7b",
        endpoint: "http://localhost:11434",
      });
    });
  });

  it("should validate valid OpenAI-compatible configuration when API key is provided", () => {
    assert.doesNotThrow(() => {
      validateAIConfig(
        {
          enabled: true,
          provider: "openai-compatible",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
        },
        { apiKey: "sk-test-key-12345" },
      );
    });
  });

  it("should reject OpenAI-compatible configuration if API key is missing", () => {
    assert.throws(
      () => {
        validateAIConfig(
          {
            enabled: true,
            provider: "openai-compatible",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
          },
          { apiKey: "" },
        );
      },
      (err: Error) => {
        assert(err instanceof AIConfigurationError);
        assert(err.message.includes("API key is required"));
        return true;
      },
    );
  });

  it("should reject invalid/unknown provider", () => {
    assert.throws(
      () => {
        validateAIConfig({
          enabled: true,
          provider: "non-existent-provider",
          model: "some-model",
          endpoint: "http://localhost:8080",
        });
      },
      (err: Error) => {
        assert(err instanceof AIConfigurationError);
        assert(err.message.includes('Unknown provider "non-existent-provider"'));
        return true;
      },
    );
  });

  it("should reject empty model when AI is enabled", () => {
    assert.throws(
      () => {
        validateAIConfig({
          enabled: true,
          provider: "ollama",
          model: "",
          endpoint: "http://localhost:11434",
        });
      },
      (err: Error) => {
        assert(err instanceof AIConfigurationError);
        assert(err.message.includes("No model configured"));
        return true;
      },
    );
  });

  it("should ignore validation errors when AI is disabled", () => {
    assert.doesNotThrow(() => {
      validateAIConfig({
        enabled: false,
        provider: "invalid-vendor",
        model: "",
        endpoint: "",
      });
    });
  });

  it("should normalize endpoints properly", () => {
    assert.equal(normalizeEndpoint("http://localhost:11434/", "ollama"), "http://localhost:11434");
    assert.equal(normalizeEndpoint("", "ollama"), "http://localhost:11434");
    assert.equal(normalizeEndpoint("", "openai-compatible"), "https://api.openai.com/v1");
    assert.equal(normalizeEndpoint("https://custom.api/v1///", "custom"), "https://custom.api/v1");
  });
});

describe("AI Foundation - Provider Factory", () => {
  it("should create OllamaProvider correctly", () => {
    const provider = createProvider({
      enabled: true,
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      endpoint: "http://localhost:11434",
    });

    assert(provider instanceof OllamaProvider);
    assert.equal(provider.name, "Ollama");
    assert.equal(provider.providerType, "ollama");
  });

  it("should create OpenAICompatibleProvider correctly", () => {
    const provider = createProvider(
      {
        enabled: true,
        provider: "openai-compatible",
        model: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1",
      },
      { apiKey: "test-token" },
    );

    assert(provider instanceof OpenAICompatibleProvider);
    assert.equal(provider.name, "OpenAI Compatible");
    assert.equal(provider.providerType, "openai-compatible");
  });

  it("should throw for unknown provider", () => {
    assert.throws(
      () => {
        createProvider({
          enabled: true,
          provider: "anthropic-custom",
          model: "claude-3",
          endpoint: "",
        });
      },
      (err: Error) => {
        assert(err instanceof AIConfigurationError);
        assert(err.message.includes('Unknown provider "anthropic-custom"'));
        return true;
      },
    );
  });
});

describe("AI Foundation - OllamaProvider (Mocked HTTP)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should check availability when reachable and model exists", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3:latest" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
    });

    const avail = await provider.isAvailable();
    assert.equal(avail.available, true);
  });

  it("should report unavailable when model is not installed", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: [{ name: "llama3:latest" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "missing-model",
    });

    const avail = await provider.isAvailable();
    assert.equal(avail.available, false);
    assert(avail.reason?.includes("not installed"));
  });

  it("should handle connection failure gracefully", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:11434");
    };

    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
    });

    const avail = await provider.isAvailable();
    assert.equal(avail.available, false);
    assert(avail.reason?.includes("Could not connect to Ollama"));
  });

  it("should execute completion successfully", async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/api/generate")) {
        const body = JSON.parse(String(init?.body)) as { model: string; prompt: string };
        assert.equal(body.model, "qwen2.5-coder:7b");
        assert.equal(body.prompt, "hello");
        return new Response(
          JSON.stringify({
            model: "qwen2.5-coder:7b",
            response: "Hello! How can I help you?",
            done: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
    });

    const resp = await provider.complete({ prompt: "hello" });
    assert.equal(resp.text, "Hello! How can I help you?");
    assert.equal(resp.model, "qwen2.5-coder:7b");
  });

  it("should throw friendly error when model is not found on complete (404)", async () => {
    globalThis.fetch = async () => {
      return new Response("model not found", { status: 404, statusText: "Not Found" });
    };

    const provider = new OllamaProvider({
      endpoint: "http://localhost:11434",
      model: "unknown-model",
    });

    await assert.rejects(
      async () => {
        await provider.complete({ prompt: "hello" });
      },
      (err: Error) => {
        assert(err instanceof AIProviderUnavailableError);
        assert(err.message.includes("was not found"));
        return true;
      },
    );
  });
});

describe("AI Foundation - OpenAICompatibleProvider (Mocked HTTP)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should require API key for availability", async () => {
    const provider = new OpenAICompatibleProvider({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      credentials: { apiKey: "" },
    });

    const avail = await provider.isAvailable();
    assert.equal(avail.available, false);
    assert(avail.reason?.includes("No API key provided"));
  });

  it("should handle 401 unauthorized gracefully", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
        status: 401,
        statusText: "Unauthorized",
      });
    };

    const provider = new OpenAICompatibleProvider({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      credentials: { apiKey: "sk-invalid" },
    });

    const avail = await provider.isAvailable();
    assert.equal(avail.available, false);
    assert(avail.reason?.includes("Authentication failed"));
  });

  it("should execute chat completion successfully", async () => {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/chat/completions")) {
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers["Authorization"], "Bearer sk-valid-key");
        return new Response(
          JSON.stringify({
            id: "chatcmpl-123",
            model: "gpt-4o-mini",
            choices: [
              {
                message: { role: "assistant", content: "AI response text" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const provider = new OpenAICompatibleProvider({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      credentials: { apiKey: "sk-valid-key" },
    });

    const resp = await provider.complete({ prompt: "Generate command" });
    assert.equal(resp.text, "AI response text");
    assert.equal(resp.finishReason, "stop");
  });

  it("should handle rate limit 429 error cleanly", async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ error: { message: "Quota exceeded for current plan" } }),
        { status: 429, statusText: "Too Many Requests" },
      );
    };

    const provider = new OpenAICompatibleProvider({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      credentials: { apiKey: "sk-valid-key" },
    });

    await assert.rejects(
      async () => {
        await provider.complete({ prompt: "test" });
      },
      (err: Error) => {
        assert(err instanceof AIProviderUnavailableError);
        assert(err.message.includes("Rate limit exceeded"));
        return true;
      },
    );
  });
});

describe("AI Foundation - AIManager & Commands", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should report Disabled status when AI is not enabled", async () => {
    const manager = new AIManager({ enabled: false });
    const status = await manager.getStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.status, "Disabled");
  });

  it("should report Connected when provider is healthy", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }] }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const manager = new AIManager({
      enabled: true,
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      endpoint: "http://localhost:11434",
    });

    const status = await manager.getStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.status, "Connected");
    assert.equal(status.provider, "Ollama");
  });

  it("should run full test suite with test()", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }] }),
          { status: 200 },
        );
      }
      if (String(url).endsWith("/api/generate")) {
        return new Response(
          JSON.stringify({ model: "qwen2.5-coder:7b", response: "OK", done: true }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const manager = new AIManager({
      enabled: true,
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      endpoint: "http://localhost:11434",
    });

    const testRes = await manager.test();
    assert.equal(testRes.success, true);
    assert.equal(testRes.steps.length, 4);
    assert(testRes.steps.every((s) => s.passed));
    assert.equal(testRes.response?.text, "OK");
  });

  it("should render CLI output for status and test without leaking secrets", async () => {
    const lines: string[] = [];
    const writeLine = (l: string) => lines.push(l);

    const manager = new AIManager(
      {
        enabled: true,
        provider: "openai-compatible",
        model: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1",
      },
      { apiKey: "super-secret-api-key-never-print" },
    );

    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (String(url).endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
          }),
          { status: 200 },
        );
      }
      return new Response("404", { status: 404 });
    };

    await handleAIStatusCommand(manager, writeLine);
    await handleAITestCommand(manager, writeLine);
    handleAIHelpCommand(writeLine);

    const fullOutput = lines.join("\n");
    assert(!fullOutput.includes("super-secret-api-key-never-print"));
    assert(fullOutput.includes("AI Status"));
    assert(fullOutput.includes("Testing AI provider..."));
    assert(fullOutput.includes("AI is ready."));
  });
});
