export function normalizeEndpoint(host: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("端口必须是 1–65535 的整数");
  const input = host.trim() || "127.0.0.1";
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  const url = new URL(withScheme);
  if (!url.port) url.port = String(port);
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

export function basicAuthorization(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}
