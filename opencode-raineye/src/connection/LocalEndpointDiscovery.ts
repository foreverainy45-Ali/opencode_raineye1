import { execFile } from "node:child_process";

export interface ListeningEndpoint {
  endpoint: string;
  port: number;
  pid?: number;
}

const WINDOWS_LISTENER = /^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i;

/**
 * Enumerate sockets already in LISTEN state. This avoids probing all 65,535
 * ports and does not depend on process-name/PID permissions.
 */
export async function enumerateLocalListeningEndpoints(): Promise<ListeningEndpoint[]> {
  if (process.platform !== "win32") return [];

  const stdout = await runNetstat();
  return parseWindowsNetstat(stdout);
}

export function parseWindowsNetstat(stdout: string): ListeningEndpoint[] {
  const results: ListeningEndpoint[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const match = WINDOWS_LISTENER.exec(line);
    if (!match) continue;

    const localAddress = parseAddress(match[1] ?? "");
    const pid = Number(match[2]);
    if (!localAddress || !Number.isInteger(pid) || pid < 0) continue;

    const endpoint = localAddress.ipv6
      ? `http://[::1]:${localAddress.port}`
      : `http://127.0.0.1:${localAddress.port}`;
    if (seen.has(endpoint)) continue;
    seen.add(endpoint);
    results.push({ endpoint, port: localAddress.port, pid });
  }

  return results;
}

function parseAddress(value: string): { port: number; ipv6: boolean } | undefined {
  let host = "";
  let portText = "";

  if (value.startsWith("[")) {
    const closing = value.lastIndexOf("]:");
    if (closing < 0) return undefined;
    host = value.slice(1, closing).toLowerCase();
    portText = value.slice(closing + 2);
  } else {
    const separator = value.lastIndexOf(":");
    if (separator < 0) return undefined;
    host = value.slice(0, separator).toLowerCase();
    portText = value.slice(separator + 1);
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  if (host === "127.0.0.1" || host === "0.0.0.0" || host === "localhost") return { port, ipv6: false };
  if (host === "::1" || host === "::") return { port, ipv6: true };
  return undefined;
}

async function runNetstat(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "netstat",
      ["-ano", "-p", "tcp"],
      { windowsHide: true, timeout: 5_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    );
  });
}
