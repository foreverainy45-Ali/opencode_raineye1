import { describe, expect, it } from "vitest";
import { basicAuthorization, normalizeEndpoint } from "../src/shared/endpoint";

describe("normalizeEndpoint", () => {
  it("adds the HTTP scheme and requested port", () => {
    expect(normalizeEndpoint("127.0.0.1", 4096)).toBe("http://127.0.0.1:4096");
  });

  it("preserves an explicit scheme and port", () => {
    expect(normalizeEndpoint("https://opencode.example:8443/", 4096)).toBe("https://opencode.example:8443");
  });

  it("adds the port to a URL without one", () => {
    expect(normalizeEndpoint("https://opencode.example", 4430)).toBe("https://opencode.example:4430");
  });

  it("rejects invalid ports", () => {
    expect(() => normalizeEndpoint("localhost", 0)).toThrow(/1–65535/);
    expect(() => normalizeEndpoint("localhost", 70_000)).toThrow(/1–65535/);
  });
});

describe("basicAuthorization", () => {
  it("uses the official opencode username", () => {
    expect(basicAuthorization("secret")).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`);
  });
});
