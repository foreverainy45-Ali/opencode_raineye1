import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Config, McpLocalConfig, McpRemoteConfig, ProviderConfig } from "@opencode-ai/sdk/v2";
import { applyEdits, modify, parse, type ParseError, printParseErrorCode } from "jsonc-parser";

export type ConfigScope = "project" | "global";

export interface LegacyConfigInfo {
  scope: ConfigScope;
  path: string;
  keys: string[];
}

const MIGRATABLE_KEYS = ["mcp", "provider", "skills"] as const;

export class OpenCodeConfigStore {
  constructor(private readonly workspacePath: string) {}

  async read(scope: ConfigScope): Promise<Config> {
    const file = await this.configPath(scope);
    return await this.readConfig(file, true);
  }

  async upsertMcp(scope: ConfigScope, name: string, config: McpLocalConfig | McpRemoteConfig): Promise<string> {
    const current = await this.read(scope);
    const existing = current.mcp?.[name];
    const compatible = existing && "type" in existing && existing.type === config.type ? existing : undefined;
    const merged = {
      ...compatible,
      ...config,
      ...(config.type === "local" && compatible?.type === "local" && config.environment === undefined
        ? { environment: compatible.environment }
        : {}),
      ...(config.type === "remote" && compatible?.type === "remote" ? {
        ...(config.headers === undefined ? { headers: compatible.headers } : {}),
        ...(config.oauth === undefined ? { oauth: compatible.oauth } : {}),
      } : {}),
    } as McpLocalConfig | McpRemoteConfig;
    return await this.update(scope, ["mcp", name], merged);
  }

  async deleteMcp(scope: ConfigScope, name: string): Promise<string> {
    return await this.update(scope, ["mcp", name], undefined);
  }

  async upsertProvider(scope: ConfigScope, providerId: string, provider: ProviderConfig): Promise<string> {
    return await this.update(scope, ["provider", providerId], provider);
  }

  async addSkillPath(scope: ConfigScope, value: string): Promise<string> {
    const current = await this.read(scope);
    const paths = [...new Set([...(current.skills?.paths ?? []), value.trim()])];
    return await this.update(scope, ["skills", "paths"], paths);
  }

  async detectLegacy(scope: ConfigScope): Promise<LegacyConfigInfo | undefined> {
    const file = this.legacyConfigPath(scope);
    const config = await this.readConfig(file, false);
    const keys = MIGRATABLE_KEYS.filter((key) => config[key] !== undefined);
    return keys.length ? { scope, path: file, keys } : undefined;
  }

  async migrateLegacy(info: LegacyConfigInfo): Promise<string> {
    const legacy = await this.readConfig(info.path, false);
    let target = await this.configPath(info.scope);
    for (const key of MIGRATABLE_KEYS) {
      if (legacy[key] === undefined) continue;
      const current = await this.read(info.scope);
      const merged = mergeObjects(current[key], legacy[key]);
      target = await this.update(info.scope, [key], merged);
    }
    return target;
  }

  async configPath(scope: ConfigScope): Promise<string> {
    const directory = scope === "project" ? this.workspacePath : globalConfigDirectory();
    const candidates = scope === "project"
      ? [
        path.join(directory, "opencode.json"),
        path.join(directory, "opencode.jsonc"),
        path.join(directory, ".opencode", "opencode.json"),
        path.join(directory, ".opencode", "opencode.jsonc"),
      ]
      : [path.join(directory, "opencode.json"), path.join(directory, "opencode.jsonc")];
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
    return candidates[0]!;
  }

  private legacyConfigPath(scope: ConfigScope): string {
    const directory = scope === "project" ? this.workspacePath : globalConfigDirectory();
    return path.join(directory, "config.json");
  }

  private async update(scope: ConfigScope, jsonPath: Array<string | number>, value: unknown): Promise<string> {
    const file = await this.configPath(scope);
    await fs.mkdir(path.dirname(file), { recursive: true });
    let text = await readText(file) ?? '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
    assertValidJsonc(text, file);
    const edits = modify(text, jsonPath, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" },
    });
    text = applyEdits(text, edits);
    if (!text.endsWith("\n")) text += "\n";
    assertValidJsonc(text, file);
    await fs.writeFile(file, text, "utf8");
    return file;
  }

  private async readConfig(file: string, missingAsEmpty: boolean): Promise<Config> {
    const text = await readText(file);
    if (text === undefined) {
      if (missingAsEmpty) return {};
      return {};
    }
    const errors: ParseError[] = [];
    const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as Config | undefined;
    if (errors.length || !value || typeof value !== "object") {
      const detail = errors[0] ? printParseErrorCode(errors[0].error) : "root is not an object";
      throw new Error(`无法解析 OpenCode 配置 ${file}：${detail}`);
    }
    return value;
  }
}

function globalConfigDirectory(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg ? path.resolve(xdg) : path.join(os.homedir(), ".config"), "opencode");
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertValidJsonc(text: string, file: string): void {
  const errors: ParseError[] = [];
  parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw new Error(`拒绝写入无效 OpenCode 配置 ${file}：${printParseErrorCode(errors[0]!.error)}`);
}

function mergeObjects(left: unknown, right: unknown): unknown {
  if (!isRecord(left) || !isRecord(right)) return right;
  const result: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) result[key] = mergeObjects(result[key], value);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
