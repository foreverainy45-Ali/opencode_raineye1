import { describe, expect, it } from "vitest";
import { parsePowerShellProcessIds, parseWindowsTasklist } from "../src/connection/OpenCodeProcessDiscovery";

describe("OpenCode process diagnostics", () => {
  it("parses PowerShell process IDs", () => {
    expect(parsePowerShellProcessIds("30284\r\n31500\r\n30284\r\n")).toEqual([30284, 31500]);
  });

  it("parses tasklist CSV and ignores non-OpenCode rows", () => {
    const output = [
      '"opencode.exe","30284","Console","1","120,000 K"',
      '"node.exe","31000","Console","1","80,000 K"',
      '"opencode.exe","31500","Console","1","121,000 K"',
    ].join("\r\n");
    expect(parseWindowsTasklist(output)).toEqual([30284, 31500]);
  });
});
