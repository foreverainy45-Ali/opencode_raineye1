import { describe, expect, it } from "vitest";
import { renderSkillMarkdown } from "../src/opencode/SkillFile";

describe("renderSkillMarkdown", () => {
  it("renders OpenCode-compatible frontmatter and instructions", () => {
    expect(renderSkillMarkdown({
      kind: "create",
      scope: "project",
      name: "python-test",
      description: "Run a test: safely",
      instructions: "# Steps\n\nRun the script.\n",
    })).toBe([
      "---",
      "name: python-test",
      "description: \"Run a test: safely\"",
      "---",
      "",
      "# Steps",
      "",
      "Run the script.",
      "",
    ].join("\n"));
  });
});
