import { execFile } from "node:child_process";

/**
 * Process-name lookup is diagnostic only. A PID cannot identify a connectable
 * OpenCode instance without a verified HTTP endpoint.
 */
export async function findOpenCodeProcessIds(): Promise<number[]> {
  if (process.platform !== "win32") return [];
  try {
    return parsePowerShellProcessIds(await runPowerShellProcessList());
  } catch {
    const stdout = await runTasklist();
    return parseWindowsTasklist(stdout);
  }
}

export function parsePowerShellProcessIds(stdout: string): number[] {
  return [...new Set(stdout.split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

export function parseWindowsTasklist(stdout: string): number[] {
  const results: number[] = [];
  const seen = new Set<number>();

  for (const line of stdout.split(/\r?\n/)) {
    const fields = parseCsvLine(line.trim());
    if (!fields || fields[0]?.toLocaleLowerCase() !== "opencode.exe") continue;
    const pid = Number(fields[1]);
    if (!Number.isInteger(pid) || pid < 1 || seen.has(pid)) continue;
    seen.add(pid);
    results.push(pid);
  }

  return results;
}

function parseCsvLine(line: string): string[] | undefined {
  if (!line.startsWith('"')) return undefined;
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current);
  return fields;
}

async function runTasklist(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "tasklist",
      ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq opencode.exe"],
      { windowsHide: true, timeout: 4_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    );
  });
}

async function runPowerShellProcessList(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process -Name opencode -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }",
      ],
      { windowsHide: true, timeout: 4_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    );
  });
}
