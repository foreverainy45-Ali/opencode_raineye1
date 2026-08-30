import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeConfigStore } from "../src/opencode/OpenCodeConfigStore";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function temporaryWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "raineye-config-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("OpenCodeConfigStore", () => {
  it("writes official opencode.jsonc and preserves comments", async () => {
    const workspace = await temporaryWorkspace();
    const file = path.join(workspace, "opencode.jsonc");
    await fs.writeFile(file, '{\n  // keep this comment\n  "$schema": "https://opencode.ai/config.json",\n}\n', "utf8");
    const store = new OpenCodeConfigStore(workspace);

    await store.upsertMcp("project", "python-test", {
      type: "local",
      command: ["python", "server.py"],
      cwd: workspace,
      enabled: true,
    });
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("// keep this comment");
    expect((await store.read("project")).mcp?.["python-test"]).toMatchObject({ cwd: workspace });

    await store.deleteMcp("project", "python-test");
    expect((await store.read("project")).mcp?.["python-test"]).toBeUndefined();
  });

  it("detects and migrates legacy config.json into opencode.json", async () => {
    const workspace = await temporaryWorkspace();
    await fs.writeFile(path.join(workspace, "config.json"), JSON.stringify({
      mcp: { legacy: { type: "local", command: ["python", "legacy.py"] } },
      provider: { custom: { name: "Custom", models: { model: { name: "Model" } } } },
    }), "utf8");
    const store = new OpenCodeConfigStore(workspace);
    const legacy = await store.detectLegacy("project");
    expect(legacy?.keys).toEqual(["mcp", "provider"]);

    await store.migrateLegacy(legacy!);
    const official = await store.read("project");
    expect(official.mcp?.legacy).toBeDefined();
    expect(official.provider?.custom?.models?.model?.name).toBe("Model");
    expect(await fs.readFile(path.join(workspace, "opencode.json"), "utf8")).toContain("https://opencode.ai/config.json");
  });

  it("adds, resolves and removes multiple Skill paths", async () => {
    const workspace = await temporaryWorkspace();
    const store = new OpenCodeConfigStore(workspace);

    await store.addSkillPaths("project", ["./skills/one", "./skills/two", "./skills/one"]);
    expect((await store.read("project")).skills?.paths).toEqual(["./skills/one", "./skills/two"]);
    expect(await store.listSkillRegistrations()).toEqual(expect.arrayContaining([
      { scope: "project", source: "./skills/one", resolvedPath: path.join(workspace, "skills", "one") },
      { scope: "project", source: "./skills/two", resolvedPath: path.join(workspace, "skills", "two") },
    ]));

    await store.deleteSkillPath("project", "./skills/one");
    expect((await store.read("project")).skills?.paths).toEqual(["./skills/two"]);
    await store.deleteSkillPath("project", "./skills/two");
    expect((await store.read("project")).skills?.paths).toBeUndefined();
  });
});
