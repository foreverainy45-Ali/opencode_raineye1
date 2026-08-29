import { describe, expect, it } from "vitest";
import { parseWindowsNetstat } from "../src/connection/LocalEndpointDiscovery";

describe("parseWindowsNetstat", () => {
  it("returns only loopback or wildcard TCP listeners with their PIDs", () => {
    const output = `
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:51111        0.0.0.0:0              LISTENING       4200
  TCP    0.0.0.0:4096           0.0.0.0:0              LISTENING       4300
  TCP    192.168.1.5:8080       0.0.0.0:0              LISTENING       4400
  TCP    127.0.0.1:51112        127.0.0.1:62000        ESTABLISHED     4500
  TCP    [::1]:52222            [::]:0                 LISTENING       4600
  TCP    [::]:4096              [::]:0                 LISTENING       4300
`;

    expect(parseWindowsNetstat(output)).toEqual([
      { endpoint: "http://127.0.0.1:51111", port: 51111, pid: 4200 },
      { endpoint: "http://127.0.0.1:4096", port: 4096, pid: 4300 },
      { endpoint: "http://[::1]:52222", port: 52222, pid: 4600 },
      { endpoint: "http://[::1]:4096", port: 4096, pid: 4300 },
    ]);
  });

  it("deduplicates endpoints that netstat repeats", () => {
    const line = "  TCP    127.0.0.1:4096    0.0.0.0:0    LISTENING    1234";
    expect(parseWindowsNetstat(`${line}\r\n${line}`)).toHaveLength(1);
  });
});
