#!/usr/bin/env node
import { Command } from "commander";
import { buildInitCommand } from "./init.js";
import { buildReportCommand } from "./report.js";
import { buildRunCommand } from "./run.js";
import { buildVerifyCommand } from "./verify.js";

const program = new Command();

program
  .name("blackbox")
  .description("Agent Blackbox: a local flight recorder for AI coding agents")
  .version("0.1.0");

program.addCommand(buildInitCommand());
program.addCommand(buildRunCommand());
program.addCommand(buildReportCommand());
program.addCommand(buildVerifyCommand());

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof Error && error.name === "CommanderError") {
    process.exitCode = Number((error as Error & { exitCode?: number }).exitCode ?? 1);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
