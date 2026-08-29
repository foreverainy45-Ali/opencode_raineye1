import { describe, expect, it } from "vitest";
import { buildCustomProviderConfig } from "../src/opencode/CustomProviderConfig";

describe("buildCustomProviderConfig", () => {
  it("builds an OpenCode native OpenAI-compatible provider and preserves existing models", () => {
    const provider = buildCustomProviderConfig({
      name: "Old name",
      npm: "@ai-sdk/openai-compatible",
      options: { apiKey: "{env:OLD_KEY}", customOption: true },
      models: { old: { name: "Old model" } },
    }, {
      scope: "project",
      providerId: "custom-openai",
      providerName: "Custom OpenAI",
      modelId: "vision-1",
      modelName: "Vision 1",
      baseUrl: "https://example.test/v1///",
      apiKey: "{env:CUSTOM_API_KEY}",
      npm: "@ai-sdk/openai-compatible",
      contextLimit: 100_000,
      outputLimit: 8_000,
      supportsImages: true,
      reasoning: true,
    });

    expect(provider.options).toMatchObject({
      apiKey: "{env:CUSTOM_API_KEY}",
      baseURL: "https://example.test/v1",
      customOption: true,
    });
    expect(provider.models?.old?.name).toBe("Old model");
    expect(provider.models?.["vision-1"]).toMatchObject({
      name: "Vision 1",
      attachment: true,
      reasoning: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 100_000, output: 8_000 },
    });
  });

  it("does not erase a stored API key when the form leaves it blank", () => {
    const provider = buildCustomProviderConfig({
      options: { apiKey: "secret" },
      models: {},
    }, {
      scope: "global",
      providerId: "custom",
      providerName: "Custom",
      modelId: "text-1",
      modelName: "Text 1",
      baseUrl: "https://example.test/v1",
      npm: "@ai-sdk/openai-compatible",
    });
    expect(provider.options?.apiKey).toBe("secret");
  });
});
