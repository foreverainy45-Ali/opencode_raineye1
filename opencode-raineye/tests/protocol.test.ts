import { describe, expect, it } from "vitest";
import { isWebviewMessage } from "../src/shared/protocol";

describe("isWebviewMessage", () => {
  it("accepts supported message types", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
    expect(isWebviewMessage({ type: "send", text: "hello", mode: "craft", attachments: [] })).toBe(true);
    expect(isWebviewMessage({ type: "save-mcp", mcp: { name: "fs", scope: "project", type: "local", command: ["server"] } })).toBe(true);
    expect(isWebviewMessage({ type: "search-files", requestId: 1, query: "src/" })).toBe(true);
    expect(isWebviewMessage({
      type: "save-skill",
      skill: { kind: "create", scope: "project", name: "test-skill", description: "Test", instructions: "Run it." },
    })).toBe(true);
    expect(isWebviewMessage({
      type: "save-custom-model",
      model: {
        scope: "project",
        providerId: "custom-openai",
        providerName: "Custom OpenAI",
        modelId: "model-1",
        modelName: "Model 1",
        baseUrl: "https://example.test/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })).toBe(true);
  });

  it("rejects unknown or non-object messages", () => {
    expect(isWebviewMessage({ type: "execute-arbitrary" })).toBe(false);
    expect(isWebviewMessage({ type: "send" })).toBe(false);
    expect(isWebviewMessage({ type: "open-file", path: 12 })).toBe(false);
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage("ready")).toBe(false);
    expect(isWebviewMessage({ type: "save-skill", skill: { kind: "create", name: "Not Valid" } })).toBe(false);
    expect(isWebviewMessage({
      type: "save-custom-model",
      model: { scope: "project", providerId: "custom", providerName: "Custom", modelId: "m", modelName: "M", baseUrl: "file:///key", npm: "@ai-sdk/openai-compatible" },
    })).toBe(false);
  });
});
