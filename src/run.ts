import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { EventWriter, type BlackboxEvent } from "./events.js";
import { gitDiff, gitPorcelain, gitStatus, isGitRepo, netFileChanges, type FileChange } from "./git.js";
import { generateReport } from "./report.js";
import { evaluatePolicyEvent, loadPolicy, type PolicyConfig, type PolicyViolation, type Severity } from "./policy.js";
import { ensureDir, safeTimestamp, shellJoin, shortId, writeJson } from "./utils.js";
import type { ReportManifest, Score } from "./htmlReport.js";

type RunOptions = {
  policy?: string;
  test?: string;
  allowNoGit?: boolean;
};

type SpawnCaptureOptions = {
  cwd: string;
  eventWriter: EventWriter;
  eventType: "command" | "test";
  terminalLogPath: string;
  specificLogPath: string;
  policy: PolicyConfig;
  violations: PolicyViolation[];
};

const severityRank: Record<Severity | "clean", number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

async function appendLogs(paths: string[], chunk: Buffer): Promise<void> {
  await Promise.all(paths.map((logPath) => appendFile(logPath, chunk)));
}

async function emitAndEvaluate(
  eventWriter: EventWriter,
  policy: PolicyConfig,
  violations: PolicyViolation[],
  type: Parameters<EventWriter["emit"]>[0],
  data: Record<string, unknown>,
): Promise<BlackboxEvent> {
  const event = await eventWriter.emit(type, data);
  const matched = evaluatePolicyEvent(policy, event);
  for (const violation of matched) {
    violations.push(violation);
    await eventWriter.emit("policy.violation", violation as unknown as Record<string, unknown>);
  }
  return event;
}

function spawnAndCapture(command: string, args: string[], options: SpawnCaptureOptions): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const pendingOutput: Promise<unknown>[] = [];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    child.on("error", reject);

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      const task = appendLogs([options.terminalLogPath, options.specificLogPath], chunk).then(() =>
        emitAndEvaluate(options.eventWriter, options.policy, options.violations, `${options.eventType}.output`, {
          stream: "stdout",
          text: chunk.toString("utf8"),
        }),
      );
      pendingOutput.push(task);
      task.catch(() => undefined);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      const task = appendLogs([options.terminalLogPath, options.specificLogPath], chunk).then(() =>
        emitAndEvaluate(options.eventWriter, options.policy, options.violations, `${options.eventType}.output`, {
          stream: "stderr",
          text: chunk.toString("utf8"),
        }),
      );
      pendingOutput.push(task);
      task.catch(() => undefined);
    });

    child.on("close", (exitCode, signal) => {
      Promise.all(pendingOutput)
        .then(() => resolve({ exitCode, signal }))
        .catch(reject);
    });
  });
}

function testCommandParts(testCommand: string): { command: string; args: string[] } {
  return {
    command: testCommand,
    args: [],
  };
}

async function runShellCommand(testCommand: string, options: SpawnCaptureOptions): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const pendingOutput: Promise<unknown>[] = [];
    const child = spawn(testCommand, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
    });

    child.on("error", reject);

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      const task = appendLogs([options.terminalLogPath, options.specificLogPath], chunk).then(() =>
        emitAndEvaluate(options.eventWriter, options.policy, options.violations, `${options.eventType}.output`, {
          stream: "stdout",
          text: chunk.toString("utf8"),
        }),
      );
      pendingOutput.push(task);
      task.catch(() => undefined);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      const task = appendLogs([options.terminalLogPath, options.specificLogPath], chunk).then(() =>
        emitAndEvaluate(options.eventWriter, options.policy, options.violations, `${options.eventType}.output`, {
          stream: "stderr",
          text: chunk.toString("utf8"),
        }),
      );
      pendingOutput.push(task);
      task.catch(() => undefined);
    });

    child.on("close", (exitCode, signal) => {
      Promise.all(pendingOutput)
        .then(() => resolve({ exitCode, signal }))
        .catch(reject);
    });
  });
}

function riskLevel(violations: PolicyViolation[]): Score["riskLevel"] {
  let max: Severity | "clean" = "clean";
  for (const violation of violations) {
    if (severityRank[violation.severity] > severityRank[max]) {
      max = violation.severity;
    }
  }
  return max;
}

function scoreRun(violations: PolicyViolation[], testExitCode: number | null, testsSkipped: boolean, testCommand?: string): Score {
  const testsPassed = testsSkipped ? true : testExitCode === 0;
  const risk = riskLevel(violations);
  const hasCritical = violations.some((violation) => violation.severity === "critical");
  const hasHigh = violations.some((violation) => violation.severity === "high");
  let score = 100;

  if (!testsPassed) {
    score -= 50;
  }

  for (const violation of violations) {
    if (violation.severity === "critical") {
      score -= 40;
    } else if (violation.severity === "high") {
      score -= 20;
    } else if (violation.severity === "medium") {
      score -= 10;
    } else {
      score -= 5;
    }
  }

  let verdict: Score["verdict"];
  if (hasCritical) {
    verdict = "critical";
  } else if (hasHigh || violations.length > 0) {
    verdict = "suspicious";
  } else if (!testsPassed) {
    verdict = "failed";
  } else {
    verdict = "clean";
  }

  return {
    testsPassed,
    testsSkipped,
    testCommand,
    testExitCode,
    riskLevel: risk,
    verdict,
    score: Math.max(0, score),
  };
}

async function emitFileChanges(eventWriter: EventWriter, policy: PolicyConfig, violations: PolicyViolation[], changes: FileChange[]): Promise<void> {
  for (const change of changes) {
    const type = change.type === "added" ? "file.added" : change.type === "deleted" ? "file.deleted" : "file.changed";
    await emitAndEvaluate(eventWriter, policy, violations, type, {
      path: change.path,
      oldPath: change.oldPath,
      gitStatus: change.status,
    });
  }
}

export async function runBlackbox(commandArgs: string[], options: RunOptions): Promise<string> {
  const cwd = process.cwd();
  if (commandArgs.length === 0) {
    throw new Error("Missing wrapped command. Use: blackbox run -- <command...>");
  }

  const [policyLoad, insideGit] = await Promise.all([loadPolicy(cwd, options.policy), isGitRepo(cwd)]);

  if (!insideGit && !options.allowNoGit) {
    throw new Error("Current directory is not a git repository. Run inside a git repo or pass --allow-no-git.");
  }

  const beforeStatus = insideGit ? await gitStatus(cwd) : "Not a git repository; git status capture disabled.\n";
  const beforePorcelain = insideGit ? await gitPorcelain(cwd) : "";
  const startedAt = new Date();
  const runId = `${safeTimestamp(startedAt)}-${shortId()}`;
  const runDir = path.join(cwd, ".blackbox", "runs", runId);
  const terminalLogPath = path.join(runDir, "terminal.log");
  const wrappedLogPath = path.join(runDir, "wrapped-command.log");
  const testLogPath = path.join(runDir, "test.log");
  const eventsPath = path.join(runDir, "events.jsonl");
  const eventWriter = new EventWriter(eventsPath);
  const violations: PolicyViolation[] = [];

  await ensureDir(runDir);
  await Promise.all([
    writeFile(terminalLogPath, ""),
    writeFile(wrappedLogPath, ""),
    writeFile(testLogPath, ""),
    writeFile(path.join(runDir, "git-status-before.txt"), beforeStatus),
  ]);
  await eventWriter.init();

  const manifest: ReportManifest = {
    runId,
    startedAt: startedAt.toISOString(),
    cwd,
    command: commandArgs,
    policyPath: policyLoad.path,
    policySource: policyLoad.source,
    isGitRepo: insideGit,
    blackboxVersion: "0.1.0",
  };
  await writeJson(path.join(runDir, "manifest.json"), manifest);

  const wrappedCommand = shellJoin(commandArgs);
  console.log(`Agent Blackbox run: ${runId}`);
  console.log(`Evidence directory: ${runDir}`);
  console.log(`Wrapped command: ${wrappedCommand}`);

  await eventWriter.emit("run.start", {
    cwd,
    command: wrappedCommand,
    policySource: policyLoad.source,
    policyPath: policyLoad.path,
  });
  await eventWriter.emit("command.start", {
    command: wrappedCommand,
    argv: commandArgs,
  });

  const commandResult = await spawnAndCapture(commandArgs[0] ?? "", commandArgs.slice(1), {
    cwd,
    eventWriter,
    eventType: "command",
    terminalLogPath,
    specificLogPath: wrappedLogPath,
    policy: policyLoad.policy,
    violations,
  });

  await eventWriter.emit("command.exit", {
    exitCode: commandResult.exitCode,
    signal: commandResult.signal,
  });

  const afterStatus = insideGit ? await gitStatus(cwd) : "Not a git repository; git status capture disabled.\n";
  const afterPorcelain = insideGit ? await gitPorcelain(cwd) : "";
  const diff = insideGit ? await gitDiff(cwd) : "";
  const changes = insideGit ? netFileChanges(beforePorcelain, afterPorcelain) : [];
  await Promise.all([
    writeFile(path.join(runDir, "git-status-after.txt"), afterStatus),
    writeFile(path.join(runDir, "diff.patch"), diff),
  ]);
  await emitFileChanges(eventWriter, policyLoad.policy, violations, changes);

  const testCommand = options.test ?? policyLoad.policy.test?.command;
  let testExitCode: number | null = null;
  let testsSkipped = true;

  if (testCommand && testCommand.trim().length > 0) {
    testsSkipped = false;
    const parts = testCommandParts(testCommand);
    await eventWriter.emit("test.start", {
      command: testCommand,
    });
    console.log(`Running tests: ${testCommand}`);
    const testResult = await runShellCommand(parts.command, {
      cwd,
      eventWriter,
      eventType: "test",
      terminalLogPath,
      specificLogPath: testLogPath,
      policy: policyLoad.policy,
      violations,
    });
    testExitCode = testResult.exitCode;
    await eventWriter.emit("test.exit", {
      exitCode: testResult.exitCode,
      signal: testResult.signal,
    });
  } else {
    await writeFile(testLogPath, "No test command configured.\n");
  }

  const score = scoreRun(violations, testExitCode, testsSkipped, testCommand);
  const endedAt = new Date();
  manifest.endedAt = endedAt.toISOString();
  manifest.durationMs = endedAt.getTime() - startedAt.getTime();

  await Promise.all([
    writeJson(path.join(runDir, "manifest.json"), manifest),
    writeJson(path.join(runDir, "policy-results.json"), {
      violations,
      counts: {
        total: violations.length,
        critical: violations.filter((violation) => violation.severity === "critical").length,
        high: violations.filter((violation) => violation.severity === "high").length,
        medium: violations.filter((violation) => violation.severity === "medium").length,
        low: violations.filter((violation) => violation.severity === "low").length,
      },
    }),
    writeJson(path.join(runDir, "score.json"), score),
  ]);

  await eventWriter.emit("run.end", {
    verdict: score.verdict,
    riskLevel: score.riskLevel,
    score: score.score,
    durationMs: manifest.durationMs,
  });
  await eventWriter.emit("report.generated", {
    path: path.join(runDir, "report.html"),
  });

  await generateReport(runDir);

  console.log("");
  console.log(`Verdict: ${score.verdict} | Risk: ${score.riskLevel} | Score: ${score.score}/100`);
  console.log(`Report: ${path.join(runDir, "report.html")}`);

  if (commandResult.exitCode && commandResult.exitCode !== 0) {
    process.exitCode = commandResult.exitCode;
  }

  return runDir;
}

export function buildRunCommand(): Command {
  return new Command("run")
    .description("Wrap a command, record terminal output, git diffs, tests, policy results, and a local HTML report")
    .option("--policy <path>", "Path to blackbox.yml policy")
    .option("--test <command>", "Test command to run after the wrapped command")
    .option("--allow-no-git", "Allow running without a git repository; diff and file-change capture are disabled")
    .allowUnknownOption(true)
    .argument("[command...]", "Wrapped command after --")
    .action(async (command: string[], options: RunOptions) => {
      await runBlackbox(command, options);
    });
}
