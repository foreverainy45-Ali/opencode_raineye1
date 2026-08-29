import * as path from "node:path";
import { createAuthenticatedFetch } from "./authenticatedFetch";

export interface OpenCodePathInfo {
  directory?: string;
  worktree?: string;
}

export type ProbeResult =
  | { status: "healthy"; version: string; path?: OpenCodePathInfo }
  | { status: "auth-required" }
  | { status: "unavailable"; error?: unknown };

export async function probeOpenCode(
  endpoint: string,
  options: { password?: string; timeoutMs: number },
): Promise<ProbeResult> {
  const request = createAuthenticatedFetch(options.password);
  try {
    const response = await fetchJsonWithTimeout(request, `${endpoint}/global/health`, options.timeoutMs);
    if (response.status === 401) return { status: "auth-required" };
    if (!response.ok) return { status: "unavailable", error: new Error(`HTTP ${response.status}`) };

    const health = response.value as { healthy?: unknown; version?: unknown };
    if (health.healthy !== true || typeof health.version !== "string" || !health.version.trim()) {
      return { status: "unavailable", error: new Error("Invalid OpenCode health response") };
    }

    const pathInfo = await fetchPath(request, endpoint, options.timeoutMs);
    if (pathInfo === "auth-required") return { status: "auth-required" };
    return { status: "healthy", version: health.version, path: pathInfo };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  action: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer");
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await action(item, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export function pathMatchesWorkspace(pathInfo: OpenCodePathInfo | undefined, workspacePath: string): boolean {
  if (!pathInfo) return false;
  const workspace = canonicalPath(workspacePath);
  return [pathInfo.directory, pathInfo.worktree]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => canonicalPath(value) === workspace);
}

export function preferredWorkspacePath(pathInfo: OpenCodePathInfo | undefined, workspacePath: string): string | undefined {
  if (!pathInfo) return undefined;
  if (pathInfo.directory && canonicalPath(pathInfo.directory) === canonicalPath(workspacePath)) return pathInfo.directory;
  if (pathInfo.worktree && canonicalPath(pathInfo.worktree) === canonicalPath(workspacePath)) return pathInfo.worktree;
  return pathInfo.directory ?? pathInfo.worktree;
}

async function fetchPath(
  request: typeof fetch,
  endpoint: string,
  timeoutMs: number,
): Promise<OpenCodePathInfo | "auth-required" | undefined> {
  try {
    const response = await fetchJsonWithTimeout(request, `${endpoint}/path`, timeoutMs);
    if (response.status === 401) return "auth-required";
    if (!response.ok) return undefined;
    const value = response.value as Record<string, unknown>;
    const directory = typeof value.directory === "string" ? value.directory : undefined;
    const worktree = typeof value.worktree === "string" ? value.worktree : undefined;
    return directory || worktree ? { directory, worktree } : undefined;
  } catch {
    // A valid health response remains usable with older OpenCode versions that
    // do not expose /path or when the secondary request races a shutdown.
    return undefined;
  }
}

async function fetchJsonWithTimeout(
  request: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; value?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const value = response.ok ? await response.json() : undefined;
    return { ok: response.ok, status: response.status, value };
  } finally {
    clearTimeout(timer);
  }
}

function canonicalPath(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}
