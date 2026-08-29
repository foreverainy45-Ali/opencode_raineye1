import * as vscode from "vscode";

type LogLevel = "debug" | "info" | "warn" | "error";

const PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel("RainEye for OpenCode");

  constructor(private level: LogLevel = "info") {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, detail?: unknown): void {
    this.write("debug", message, detail);
  }

  info(message: string, detail?: unknown): void {
    this.write("info", message, detail);
  }

  warn(message: string, detail?: unknown): void {
    this.write("warn", message, detail);
  }

  error(message: string, detail?: unknown): void {
    this.write("error", message, detail);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private write(level: LogLevel, message: string, detail?: unknown): void {
    if (PRIORITY[level] < PRIORITY[this.level]) return;
    const timestamp = new Date().toISOString();
    const suffix = detail === undefined ? "" : ` ${safeFormat(detail)}`;
    this.channel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`);
  }
}

function safeFormat(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return redact(value);
  try {
    return redact(JSON.stringify(value));
  } catch {
    return "[unserializable]";
  }
}

function redact(value: string): string {
  return value
    .replace(/(authorization["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi, "$1[redacted]")
    .replace(/(clientSecret["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi, "$1[redacted]")
    .replace(/(password["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi, "$1[redacted]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi, "$1[redacted]");
}
