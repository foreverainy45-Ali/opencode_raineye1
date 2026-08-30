import * as path from "node:path";

export function findRootSkillManifest(
  entries: ReadonlyArray<readonly [name: string, isFile: boolean]>,
  caseInsensitive = process.platform === "win32",
): string | undefined {
  const exact = entries.find(([name, isFile]) => isFile && name === "SKILL.md");
  if (exact) return exact[0];
  if (!caseInsensitive) return undefined;
  return entries.find(([name, isFile]) => isFile && name.toLocaleLowerCase() === "skill.md")?.[0];
}

export function skillSourcePath(folderPath: string, workspacePath: string, scope: "project" | "global"): string {
  const absolute = path.resolve(folderPath);
  if (scope === "global") return normalizePath(absolute);
  const relative = path.relative(workspacePath, absolute);
  if (!relative) return ".";
  if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return `./${normalizePath(relative)}`;
  }
  return normalizePath(absolute);
}

export function skillDirectoryPath(location: string): string {
  return path.basename(location).toLocaleLowerCase() === "skill.md" ? path.dirname(location) : location;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
