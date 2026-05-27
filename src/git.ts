import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizePathForPolicy } from "./utils.js";

const execFileAsync = promisify(execFile);

export type FileChangeType = "added" | "changed" | "deleted";

export type FileChange = {
  type: FileChangeType;
  path: string;
  oldPath?: string;
  status: string;
};

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const result = await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return result.trim() === "true";
  } catch {
    return false;
  }
}

export async function gitStatus(cwd: string): Promise<string> {
  return git(["status", "--short"], cwd);
}

export async function gitPorcelain(cwd: string): Promise<string> {
  return git(["status", "--porcelain=v1"], cwd);
}

export async function gitDiff(cwd: string): Promise<string> {
  return git(["diff", "--binary"], cwd).catch(() => "");
}

function parsePorcelainLine(line: string): FileChange | null {
  if (line.length < 4) {
    return null;
  }

  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  const isUntracked = status === "??";
  const isDeleted = status.includes("D");
  const isAdded = isUntracked || status.includes("A");
  const isRenamed = status.includes("R");
  const isCopied = status.includes("C");

  let filePath = rawPath;
  let oldPath: string | undefined;
  if (isRenamed || isCopied) {
    const parts = rawPath.split(" -> ");
    if (parts.length === 2) {
      oldPath = normalizePathForPolicy(parts[0] ?? "");
      filePath = parts[1] ?? rawPath;
    }
  }

  const normalizedPath = normalizePathForPolicy(filePath);
  if (!normalizedPath || normalizedPath.startsWith(".blackbox/")) {
    return null;
  }

  if (isDeleted) {
    return { type: "deleted", path: normalizedPath, oldPath, status };
  }

  if (isAdded) {
    return { type: "added", path: normalizedPath, oldPath, status };
  }

  return { type: "changed", path: normalizedPath, oldPath, status };
}

export function parsePorcelain(porcelain: string): FileChange[] {
  return porcelain
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePorcelainLine)
    .filter((change): change is FileChange => change !== null);
}

export function netFileChanges(beforePorcelain: string, afterPorcelain: string): FileChange[] {
  const beforeKeys = new Set(parsePorcelain(beforePorcelain).map((change) => `${change.status}:${change.path}:${change.oldPath ?? ""}`));

  return parsePorcelain(afterPorcelain).filter((change) => {
    const key = `${change.status}:${change.path}:${change.oldPath ?? ""}`;
    return !beforeKeys.has(key);
  });
}
