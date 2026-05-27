import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { BlackboxEvent } from "./events.js";
import type { PolicyViolation } from "./policy.js";
import { escapeHtml, formatDuration, readTextIfExists } from "./utils.js";
import type { VerifyResult } from "./verify.js";

export type Score = {
  testsPassed: boolean;
  testsSkipped: boolean;
  testCommand?: string;
  testExitCode: number | null;
  riskLevel: "clean" | "low" | "medium" | "high" | "critical";
  verdict: "clean" | "failed" | "suspicious" | "critical";
  score: number;
};

export type ReportManifest = {
  runId: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  cwd: string;
  command: string[];
  policyPath?: string;
  policySource: string;
  isGitRepo: boolean;
  blackboxVersion: string;
};

export type ReportInput = {
  runDir: string;
  manifest: ReportManifest;
  events: BlackboxEvent[];
  score: Score;
  violations: PolicyViolation[];
  verify: VerifyResult;
  diff: string;
  terminalLog: string;
};

function badgeClass(verdict: Score["verdict"]): string {
  switch (verdict) {
    case "clean":
      return "clean";
    case "failed":
      return "failed";
    case "critical":
      return "critical";
    case "suspicious":
      return "suspicious";
  }
}

function eventSummary(event: BlackboxEvent): string {
  const data = event.data;
  if (typeof data.path === "string") {
    return data.path;
  }
  if (typeof data.exitCode === "number") {
    return `exit ${data.exitCode}`;
  }
  if (typeof data.text === "string") {
    return data.text.replace(/\s+/g, " ").trim().slice(0, 140);
  }
  if (typeof data.command === "string") {
    return data.command;
  }
  return "";
}

function countEvents(events: BlackboxEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

export function renderHtmlReport(input: ReportInput): string {
  const added = countEvents(input.events, "file.added");
  const changed = countEvents(input.events, "file.changed");
  const deleted = countEvents(input.events, "file.deleted");
  const duration = input.manifest.durationMs === undefined ? "unknown" : formatDuration(input.manifest.durationMs);
  const command = input.manifest.command.join(" ");
  const verifyText = input.verify.valid
    ? `valid (${input.verify.checkedEvents} events)`
    : `invalid: ${input.verify.error ?? "unknown error"}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Blackbox Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --text: #1d2329;
      --muted: #64707d;
      --line: #d9dedc;
      --clean: #176b48;
      --failed: #9a5b00;
      --suspicious: #914300;
      --critical: #a11d33;
      --ink: #101419;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      background: var(--ink);
      color: #fff;
      padding: 36px clamp(20px, 5vw, 64px);
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px clamp(16px, 4vw, 36px) 48px;
    }
    h1, h2, h3 { line-height: 1.1; margin: 0; }
    h1 { font-size: clamp(2rem, 4vw, 3.4rem); }
    h2 { font-size: 1.05rem; margin-bottom: 14px; }
    p { margin: 8px 0 0; }
    .tagline { color: #d8e0e7; font-size: 1.1rem; max-width: 720px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: -18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-width: 0;
    }
    .metric-label {
      color: var(--muted);
      font-size: .78rem;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .metric-value {
      font-size: 1.45rem;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 4px 10px;
      border-radius: 999px;
      color: #fff;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
      font-size: .78rem;
    }
    .badge.clean { background: var(--clean); }
    .badge.failed { background: var(--failed); }
    .badge.suspicious { background: var(--suspicious); }
    .badge.critical { background: var(--critical); }
    section { margin-top: 20px; }
    code, pre {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: .88rem;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #11161c;
      color: #ecf2f8;
      border-radius: 8px;
      padding: 16px;
      max-height: 620px;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: .92rem;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 700; }
    .timeline {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .timeline li {
      display: grid;
      grid-template-columns: 64px minmax(120px, 180px) 1fr;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }
    .muted { color: var(--muted); }
    details summary {
      cursor: pointer;
      font-weight: 750;
      margin-bottom: 12px;
    }
    @media (max-width: 860px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .timeline li { grid-template-columns: 48px 1fr; }
      .timeline .summary { grid-column: 1 / -1; }
    }
    @media (max-width: 560px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Agent Blackbox Report</h1>
    <p class="tagline">The agent said it worked. Blackbox shows what actually happened.</p>
  </header>
  <main>
    <div class="grid">
      <div class="card">
        <div class="metric-label">Verdict</div>
        <div class="metric-value"><span class="badge ${badgeClass(input.score.verdict)}">${escapeHtml(input.score.verdict)}</span></div>
      </div>
      <div class="card">
        <div class="metric-label">Risk</div>
        <div class="metric-value">${escapeHtml(input.score.riskLevel)}</div>
      </div>
      <div class="card">
        <div class="metric-label">Score</div>
        <div class="metric-value">${input.score.score}/100</div>
      </div>
      <div class="card">
        <div class="metric-label">Tests</div>
        <div class="metric-value">${input.score.testsSkipped ? "skipped" : input.score.testsPassed ? "passed" : "failed"}</div>
      </div>
    </div>

    <section class="card">
      <h2>Run Summary</h2>
      <table>
        <tbody>
          <tr><th>Wrapped command</th><td><code>${escapeHtml(command)}</code></td></tr>
          <tr><th>Duration</th><td>${escapeHtml(duration)}</td></tr>
          <tr><th>Working directory</th><td><code>${escapeHtml(input.manifest.cwd)}</code></td></tr>
          <tr><th>Run directory</th><td><code>${escapeHtml(path.resolve(input.runDir))}</code></td></tr>
          <tr><th>Test command</th><td>${input.score.testCommand ? `<code>${escapeHtml(input.score.testCommand)}</code>` : "none"}</td></tr>
          <tr><th>Files</th><td>${added} added, ${changed} changed, ${deleted} deleted</td></tr>
          <tr><th>Hash chain</th><td>${escapeHtml(verifyText)}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Policy Violations</h2>
      ${
        input.violations.length === 0
          ? "<p class=\"muted\">No policy violations matched.</p>"
          : `<table>
        <thead><tr><th>Severity</th><th>Rule</th><th>Matched</th></tr></thead>
        <tbody>
        ${input.violations
          .map(
            (violation) => `<tr>
              <td>${escapeHtml(violation.severity)}</td>
              <td><strong>${escapeHtml(violation.ruleId)}</strong><br><span class="muted">${escapeHtml(violation.description)}</span></td>
              <td>${escapeHtml(violation.matchedPath ?? violation.matchedText ?? "")}<br><span class="muted">${escapeHtml(violation.textExcerpt ?? violation.matchedEvent.type)}</span></td>
            </tr>`,
          )
          .join("")}
        </tbody>
      </table>`
      }
    </section>

    <section class="card">
      <h2>Timeline</h2>
      <ol class="timeline">
        ${input.events
          .map(
            (event) => `<li>
              <span class="muted">#${event.seq}</span>
              <strong>${escapeHtml(event.type)}</strong>
              <span class="summary">${escapeHtml(eventSummary(event))}</span>
            </li>`,
          )
          .join("")}
      </ol>
    </section>

    <section class="card">
      <details>
        <summary>Terminal Log</summary>
        <pre>${escapeHtml(input.terminalLog || "(empty)")}</pre>
      </details>
    </section>

    <section class="card">
      <h2>Diff Patch</h2>
      <pre>${escapeHtml(input.diff || "(empty diff)")}</pre>
    </section>
  </main>
</body>
</html>
`;
}

export async function writeHtmlReport(input: ReportInput): Promise<string> {
  const reportPath = path.join(input.runDir, "report.html");
  await writeFile(reportPath, renderHtmlReport(input), "utf8");
  return reportPath;
}

export async function readReportLogs(runDir: string): Promise<{ diff: string; terminalLog: string }> {
  const [diff, terminalLog] = await Promise.all([
    readTextIfExists(path.join(runDir, "diff.patch")),
    readTextIfExists(path.join(runDir, "terminal.log")),
  ]);
  return { diff, terminalLog };
}
