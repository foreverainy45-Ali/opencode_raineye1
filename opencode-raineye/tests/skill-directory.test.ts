import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findRootSkillManifest, skillDirectoryPath, skillSourcePath } from "../src/opencode/SkillDirectory";

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

  it("normalizes a Skill manifest location to its folder", () => {
    const folder = path.join("C:\\", "skills", "test-skill");
    expect(skillDirectoryPath(path.join(folder, "SKILL.md"))).toBe(folder);
    expect(skillDirectoryPath(folder)).toBe(folder);
  });
});
