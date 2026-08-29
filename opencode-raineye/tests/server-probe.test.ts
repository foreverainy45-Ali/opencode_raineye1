import { afterEach, describe, expect, it, vi } from "vitest";
import { mapWithConcurrency, pathMatchesWorkspace, preferredWorkspacePath, probeOpenCode } from "../src/connection/ServerProbe";

afterEach(() => vi.unstubAllGlobals());

describe("probeOpenCode", () => {
  it("classifies HTTP 401 separately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(undefined, { status: 401 })));
    expect(await probeOpenCode("http://127.0.0.1:4096", { timeoutMs: 450 })).toEqual({ status: "auth-required" });
  });

  it("requires healthy true and a non-empty OpenCode version", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ healthy: true })));
    expect((await probeOpenCode("http://127.0.0.1:4096", { timeoutMs: 450 })).status).toBe("unavailable");
  });

  it("reads /path after a valid health response", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith("/global/health")
        ? Response.json({ healthy: true, version: "1.18.25" })
        : Response.json({ directory: "E:\\repo", worktree: "E:\\repo" });
    });
    vi.stubGlobal("fetch", request);
    expect(await probeOpenCode("http://127.0.0.1:4096", { timeoutMs: 450 })).toEqual({
      status: "healthy",
      version: "1.18.25",
      path: { directory: "E:\\repo", worktree: "E:\\repo" },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("pathMatchesWorkspace", () => {
  it("matches either the OpenCode directory or worktree", () => {
    const workspace = process.platform === "win32" ? "E:\\repo" : "/repo";
    const other = process.platform === "win32" ? "E:\\other" : "/other";
    expect(pathMatchesWorkspace({ directory: other, worktree: workspace }, workspace)).toBe(true);
    expect(preferredWorkspacePath({ directory: other, worktree: workspace }, workspace)).toBe(workspace);
  });

  it("does not treat a parent directory as an exact workspace match", () => {
    const workspace = process.platform === "win32" ? "E:\\repo\\app" : "/repo/app";
    const parent = process.platform === "win32" ? "E:\\repo" : "/repo";
    expect(pathMatchesWorkspace({ directory: parent }, workspace)).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves order and respects the concurrency limit", async () => {
    let active = 0;
    let maximum = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return value * 2;
    });
    expect(values).toEqual([2, 4, 6, 8, 10, 12]);
    expect(maximum).toBe(2);
  });
});
