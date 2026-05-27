#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const exampleRoot = path.join(repoRoot, "examples", "broken-checkout");
const cheatingAgent = path.join(repoRoot, "examples", "cheating-agent.js");
const honestAgent = path.join(repoRoot, "examples", "honest-agent.js");
const keepTemp = process.env.KEEP_BLACKBOX_SMOKE === "1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, CI: "1", ...options.env },
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    const renderedCommand = [command, ...args].join(" ");
    throw new Error(
      [
        `Command failed: ${renderedCommand}`,
        `cwd: ${options.cwd ?? repoRoot}`,
        `exit: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
        result.stderr ? `stderr:\n${result.stderr}` : "stderr: <empty>",
      ].join("\n\n"),
    );
  }

  return result;
}

function copyDemoProject(targetDir) {
  cpSync(exampleRoot, targetDir, {
    recursive: true,
    filter(source) {
      const name = path.basename(source);
      return !["node_modules", ".git", ".blackbox", "blackbox.yml", "package-lock.json"].includes(name);
    },
  });
}

function latestRunDir(demoDir) {
  const runsDir = path.join(demoDir, ".blackbox", "runs");
  const runs = readdirSync(runsDir)
    .map((name) => path.join(runsDir, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort();

  if (runs.length === 0) {
    throw new Error(`No run directories found in ${runsDir}`);
  }

  return runs[runs.length - 1];
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function prepareDemo(tempRoot, name) {
  const demoDir = path.join(tempRoot, name);
  mkdirSync(demoDir, { recursive: true });
  copyDemoProject(demoDir);

  console.log(`[smoke] installing demo dependencies for ${name}`);
  run("npm", ["install"], { cwd: demoDir });

  console.log(`[smoke] creating git baseline for ${name}`);
  run("git", ["init"], { cwd: demoDir });
  run("git", ["add", "."], { cwd: demoDir });
  run("git", ["-c", "user.name=Agent Blackbox Smoke", "-c", "user.email=blackbox-smoke@example.invalid", "commit", "-m", "demo baseline"], {
    cwd: demoDir,
  });

  console.log(`[smoke] initializing blackbox policy for ${name}`);
  run(process.execPath, [cliPath, "init"], { cwd: demoDir });

  return demoDir;
}

function runAgentCase(tempRoot, name, agentPath, expectations) {
  const demoDir = prepareDemo(tempRoot, name);

  console.log(`[smoke] running ${name}`);
  run(process.execPath, [cliPath, "run", "--test", "npm test", "--", process.execPath, agentPath], { cwd: demoDir });

  const runDir = latestRunDir(demoDir);
  const score = readJson(path.join(runDir, "score.json"));
  const policyResults = readJson(path.join(runDir, "policy-results.json"));
  const violations = policyResults.violations ?? [];

  assert(score.verdict === expectations.verdict, `${name}: expected verdict ${expectations.verdict}, got ${score.verdict}`);
  assert(score.testsPassed === true, `${name}: expected testsPassed true`);

  if (expectations.requiredRuleId) {
    assert(
      violations.some((violation) => violation.ruleId === expectations.requiredRuleId),
      `${name}: expected policy violation ${expectations.requiredRuleId}`,
    );
  }

  if (expectations.noCriticalViolations) {
    assert(
      !violations.some((violation) => violation.severity === "critical"),
      `${name}: expected no critical policy violations`,
    );
  }

  console.log(`[smoke] verifying hash chain for ${name}`);
  run(process.execPath, [cliPath, "verify", runDir], { cwd: demoDir });

  console.log(`[smoke] ${name} passed (${score.verdict})`);
}

if (!existsSync(cliPath)) {
  throw new Error(`Missing ${cliPath}. Run pnpm build before pnpm test.`);
}

const tempRoot = mkdtempSync(path.join(tmpdir(), "agent-blackbox-smoke-"));
console.log(`[smoke] temp root: ${tempRoot}`);

try {
  runAgentCase(tempRoot, "cheating", cheatingAgent, {
    verdict: "critical",
    requiredRuleId: "no-test-deletion",
  });

  runAgentCase(tempRoot, "honest", honestAgent, {
    verdict: "clean",
    noCriticalViolations: true,
  });

  console.log("[smoke] all smoke tests passed");
} finally {
  if (keepTemp) {
    console.log(`[smoke] keeping temp root: ${tempRoot}`);
  } else {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
