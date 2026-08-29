import type { SkillInput } from "../shared/protocol";

export function renderSkillMarkdown(input: Extract<SkillInput, { kind: "create" }>): string {
  return [
    "---",
    `name: ${input.name}`,
    `description: ${JSON.stringify(input.description.trim())}`,
    "---",
    "",
    input.instructions.trim(),
    "",
  ].join("\n");
}
