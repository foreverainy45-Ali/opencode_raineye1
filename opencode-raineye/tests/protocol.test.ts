import { describe, expect, it } from "vitest";
import { isWebviewMessage } from "../src/shared/protocol";

describe("isWebviewMessage", () => {
  it("accepts supported message types", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
    expect(isWebviewMessage({ type: "send", text: "hello", mode: "craft", attachments: [] })).toBe(true);
    expect(isWebviewMessage({ type: "save-mcp", mcp: { name: "fs", scope: "project", type: "local", command: ["server"] } })).toBe(true);
  });

  it("rejects unknown or non-object messages", () => {
    expect(isWebviewMessage({ type: "execute-arbitrary" })).toBe(false);
    expect(isWebviewMessage({ type: "send" })).toBe(false);
    expect(isWebviewMessage({ type: "open-file", path: 12 })).toBe(false);
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage("ready")).toBe(false);
  });
});
