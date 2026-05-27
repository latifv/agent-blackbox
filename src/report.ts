import path from "node:path";
import { Command } from "commander";
import { readEvents } from "./events.js";
import { readReportLogs, writeHtmlReport, type ReportManifest, type Score } from "./htmlReport.js";
import type { PolicyViolation } from "./policy.js";
import { readJson } from "./utils.js";
import { verifyRunDir } from "./verify.js";

export async function generateReport(runDir: string): Promise<string> {
  const resolvedRunDir = path.resolve(runDir);
  const [manifest, score, policyResults, events, logs, verify] = await Promise.all([
    readJson<ReportManifest>(path.join(resolvedRunDir, "manifest.json")),
    readJson<Score>(path.join(resolvedRunDir, "score.json")),
    readJson<{ violations: PolicyViolation[] }>(path.join(resolvedRunDir, "policy-results.json")),
    readEvents(path.join(resolvedRunDir, "events.jsonl")),
    readReportLogs(resolvedRunDir),
    verifyRunDir(resolvedRunDir),
  ]);

  return writeHtmlReport({
    runDir: resolvedRunDir,
    manifest,
    events,
    score,
    violations: policyResults.violations,
    verify,
    diff: logs.diff,
    terminalLog: logs.terminalLog,
  });
}

export function buildReportCommand(): Command {
  return new Command("report")
    .description("Regenerate report.html for an existing run directory")
    .argument("<runDir>", "Run directory, for example .blackbox/runs/2026-01-01T00-00-00-000Z-abcd1234")
    .action(async (runDir: string) => {
      const reportPath = await generateReport(runDir);
      console.log(`Report written: ${reportPath}`);
    });
}
