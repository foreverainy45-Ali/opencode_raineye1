import { Bonjour, type Service } from "bonjour-service";
import { isIP } from "node:net";
import type { ListeningEndpoint } from "./LocalEndpointDiscovery";

/** Discover OpenCode's official `_http._tcp.local` advertisement. */
export async function discoverMdnsEndpoints(
  domain = "opencode.local",
  durationMs = 700,
): Promise<ListeningEndpoint[]> {
  const expectedHost = normalizeHostname(domain);
  const results = new Map<string, ListeningEndpoint>();

  return await new Promise<ListeningEndpoint[]>((resolve) => {
    let bonjour: Bonjour | undefined;
    let browser: ReturnType<Bonjour["find"]> | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try { browser?.stop(); } catch { /* best-effort cleanup */ }
      try { bonjour?.destroy(); } catch { /* best-effort cleanup */ }
      resolve([...results.values()]);
    };

    try {
      bonjour = new Bonjour(undefined, finish);
      browser = bonjour.find({ type: "http", protocol: "tcp" }, (service) => {
        const endpoint = endpointFromService(service, expectedHost);
        if (endpoint) results.set(endpoint.endpoint, endpoint);
      });
      setTimeout(finish, durationMs);
    } catch {
      finish();
    }
  });
}

function endpointFromService(service: Service, expectedHost: string): ListeningEndpoint | undefined {
  // OpenCode publishes `opencode-${port}` and supports a custom advertised host
  // through --mdns-domain. Filtering both avoids treating arbitrary HTTP mDNS
  // services as discovery candidates.
  if (!service.name.startsWith("opencode-")) return undefined;
  const advertisedHost = normalizeHostname(service.host);
  if (expectedHost && advertisedHost !== expectedHost) return undefined;
  if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65_535) return undefined;

  const host = service.addresses?.find((address) => isIP(address) === 4)
    ?? service.addresses?.find((address) => isIP(address) === 6 && !address.toLocaleLowerCase().startsWith("fe80:"))
    ?? service.host.replace(/\.$/, "");
  if (!host) return undefined;
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return { endpoint: `http://${urlHost}:${service.port}`, port: service.port };
}

function normalizeHostname(value: string): string {
  return value.trim().replace(/\.$/, "").toLocaleLowerCase();
}
