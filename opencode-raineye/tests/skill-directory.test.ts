import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findRootSkillManifest, skillSourcePath } from "../src/opencode/SkillDirectory";

describe("SkillDirectory", () => {
  it("accepts only a root SKILL.md file", () => {
    expect(findRootSkillManifest([["SKILL.md", true], ["scripts", false]], false)).toBe("SKILL.md");
    expect(findRootSkillManifest([["SKILL.md", false]], false)).toBeUndefined();
    expect(findRootSkillManifest([["nested", false]], false)).toBeUndefined();
  });

  it("uses a portable project-relative source for folders inside the workspace", () => {
    const workspace = path.resolve("C:/workspace");
    const folder = path.join(workspace, "skills", "test-skill");
    expect(skillSourcePath(folder, workspace, "project")).toBe("./skills/test-skill");
    expect(skillSourcePath(folder, workspace, "global")).toMatch(/skills\/test-skill$/);
  });
});
