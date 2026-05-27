import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { BlackboxEvent } from "./events.js";
import { normalizePathForPolicy } from "./utils.js";

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().default(""),
  event: z
    .object({
      any: z.array(z.string()).default([]),
    })
    .default({ any: [] }),
  path: z
    .object({
      glob: z.array(z.string()).default([]),
    })
    .optional(),
  contains: z
    .object({
      any: z.array(z.string()).default([]),
    })
    .optional(),
  severity: SeveritySchema,
});

const PolicySchema = z.object({
  project: z.string().optional(),
  test: z
    .object({
      command: z.string().optional(),
    })
    .optional(),
  sensitive: z
    .object({
      paths: z.array(z.string()).default([]),
    })
    .optional(),
  rules: z.array(PolicyRuleSchema).default([]),
});

export type Severity = z.infer<typeof SeveritySchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicyConfig = z.infer<typeof PolicySchema>;

export type PolicyViolation = {
  ruleId: string;
  description: string;
  severity: Severity;
  matchedEvent: {
    seq: number;
    type: string;
    timestamp: string;
  };
  matchedPath?: string;
  matchedText?: string;
  textExcerpt?: string;
};

export const defaultPolicy: PolicyConfig = {
  project: "agent-blackbox-demo",
  test: {
    command: "npm test",
  },
  sensitive: {
    paths: [".env", ".env.*", "secrets/**", "private/**"],
  },
  rules: [
    {
      id: "no-test-deletion",
      description: "Agent must not delete or weaken tests to make the suite pass",
      event: {
        any: ["file.deleted", "file.changed"],
      },
      path: {
        glob: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
      },
      severity: "critical",
    },
    {
      id: "no-secret-touch",
      description: "Agent must not touch secret files",
      event: {
        any: ["file.added", "file.changed", "file.deleted"],
      },
      path: {
        glob: [".env", ".env.*", "secrets/**", "private/**"],
      },
      severity: "critical",
    },
    {
      id: "suspicious-shell-output",
      description: "Suspicious shell/network command appeared in terminal output",
      event: {
        any: ["command.output", "test.output"],
      },
      contains: {
        any: ["rm -rf", "curl ", "wget ", "chmod 777", "base64 -d"],
      },
      severity: "high",
    },
  ],
};

export function defaultPolicyYaml(): string {
  return YAML.stringify(defaultPolicy);
}

export async function writeDefaultPolicyIfMissing(cwd: string): Promise<{ path: string; created: boolean }> {
  const policyPath = path.join(cwd, "blackbox.yml");
  const exists = await access(policyPath)
    .then(() => true)
    .catch(() => false);

  if (exists) {
    return { path: policyPath, created: false };
  }

  await writeFile(policyPath, defaultPolicyYaml(), "utf8");
  return { path: policyPath, created: true };
}

export async function loadPolicy(cwd: string, policyPath?: string): Promise<{ policy: PolicyConfig; path?: string; source: "file" | "default" }> {
  const resolvedPath = policyPath ? path.resolve(cwd, policyPath) : path.join(cwd, "blackbox.yml");
  const content = await readFile(resolvedPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && !policyPath) {
      return undefined;
    }
    throw error;
  });

  if (content === undefined) {
    return { policy: defaultPolicy, source: "default" };
  }

  const parsed = YAML.parse(content) as unknown;
  const policy = PolicySchema.parse(parsed);
  return { policy, path: resolvedPath, source: "file" };
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePathForPolicy(pattern);
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      const afterGlobstar = normalized[index + 2];
      if (afterGlobstar === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    if ("\\^$+?.()|{}[]".includes(char ?? "")) {
      source += `\\${char}`;
      continue;
    }

    source += char;
  }

  source += "$";
  return new RegExp(source);
}

function matchesAnyGlob(filePath: string, patterns: string[]): boolean {
  const normalizedPath = normalizePathForPolicy(filePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalizedPath));
}

function textExcerpt(text: string, needle: string): string {
  const index = text.indexOf(needle);
  if (index === -1) {
    return text.slice(0, 200);
  }

  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + needle.length + 80);
  return text.slice(start, end);
}

export function evaluatePolicyEvent(policy: PolicyConfig, event: BlackboxEvent): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const rule of policy.rules) {
    if (rule.event.any.length > 0 && !rule.event.any.includes(event.type)) {
      continue;
    }

    const eventPath = typeof event.data.path === "string" ? event.data.path : undefined;
    if (rule.path) {
      if (!eventPath || !matchesAnyGlob(eventPath, rule.path.glob)) {
        continue;
      }
    }

    let matchedText: string | undefined;
    let excerpt: string | undefined;
    if (rule.contains) {
      const text = typeof event.data.text === "string" ? event.data.text : "";
      matchedText = rule.contains.any.find((needle) => text.includes(needle));
      if (!matchedText) {
        continue;
      }
      excerpt = textExcerpt(text, matchedText);
    }

    violations.push({
      ruleId: rule.id,
      description: rule.description,
      severity: rule.severity,
      matchedEvent: {
        seq: event.seq,
        type: event.type,
        timestamp: event.timestamp,
      },
      matchedPath: eventPath,
      matchedText,
      textExcerpt: excerpt,
    });
  }

  return violations;
}
