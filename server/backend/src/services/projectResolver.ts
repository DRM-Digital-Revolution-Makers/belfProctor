import path from "path";

type ProjectRootLike = { id?: string; name?: string; path: string };
type ProjectAliasLike = { alias: string; projectName: string };

export type ProjectResolution = {
  folderPath?: string;
  projectName?: string;
  isExternal: boolean;
  matchedRoot?: string;
};

function normalizeSlashes(input: string): string {
  return String(input || "").trim().replace(/\//g, "\\");
}

export function normalizeWorkPath(input: string | null | undefined): string {
  const raw = normalizeSlashes(input || "");
  if (!raw) return "";
  if (raw.startsWith("\\\\")) {
    return raw.replace(/\\+$/g, "");
  }
  try {
    return path.win32.normalize(raw).replace(/\\+$/g, "");
  } catch {
    return raw.replace(/\\+$/g, "");
  }
}

export function resolveProjectFromPath(
  filePath: string | null | undefined,
  roots: ProjectRootLike[],
  aliases: ProjectAliasLike[],
): ProjectResolution {
  const normalized = normalizeWorkPath(filePath);
  if (!normalized) return { isExternal: true };

  const folderPath = normalizeWorkPath(path.win32.dirname(normalized));
  const lower = normalized.toLowerCase();
  const aliasMap = new Map(
    aliases.map((a) => [String(a.alias || "").toLowerCase(), a.projectName]),
  );

  const activeRoots = roots
    .map((r) => ({ ...r, path: normalizeWorkPath(r.path) }))
    .filter((r) => r.path)
    .sort((a, b) => b.path.length - a.path.length);

  for (const root of activeRoots) {
    const rootLower = root.path.toLowerCase();
    if (lower === rootLower || lower.startsWith(rootLower + "\\")) {
      const relative = normalized.slice(root.path.length).replace(/^\\+/, "");
      const firstPart = relative.split("\\").filter(Boolean)[0] || root.name || "";
      const aliasKey = firstPart.toLowerCase();
      return {
        folderPath,
        projectName: aliasMap.get(aliasKey) || firstPart || root.name || undefined,
        isExternal: false,
        matchedRoot: root.path,
      };
    }
  }

  const leaf = normalized.split("\\").filter(Boolean)[0] || "";
  return {
    folderPath,
    projectName: aliasMap.get(leaf.toLowerCase()),
    isExternal: true,
  };
}

