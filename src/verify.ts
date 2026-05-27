import path from "node:path";
import { Command } from "commander";
import { hashEvent, type HashableEvent } from "./hashChain.js";
import { readEvents } from "./events.js";

export type VerifyResult = {
  valid: boolean;
  checkedEvents: number;
  error?: string;
  failedSeq?: number;
};

export async function verifyRunDir(runDir: string): Promise<VerifyResult> {
  const eventsPath = path.join(runDir, "events.jsonl");
  const events = await readEvents(eventsPath);
  let expectedPrevHash = "GENESIS";

  for (const event of events) {
    if (event.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checkedEvents: event.seq - 1,
        failedSeq: event.seq,
        error: `prevHash mismatch at seq ${event.seq}`,
      };
    }

    const hashable: HashableEvent = {
      seq: event.seq,
      timestamp: event.timestamp,
      type: event.type,
      data: event.data,
      prevHash: event.prevHash,
    };
    const expectedHash = hashEvent(hashable);

    if (event.hash !== expectedHash) {
      return {
        valid: false,
        checkedEvents: event.seq - 1,
        failedSeq: event.seq,
        error: `hash mismatch at seq ${event.seq}`,
      };
    }

    expectedPrevHash = event.hash;
  }

  return {
    valid: true,
    checkedEvents: events.length,
  };
}

export function buildVerifyCommand(): Command {
  return new Command("verify")
    .description("Verify the events.jsonl hash chain for a run directory")
    .argument("<runDir>", "Run directory, for example .blackbox/runs/2026-01-01T00-00-00-000Z-abcd1234")
    .action(async (runDir: string) => {
      const result = await verifyRunDir(path.resolve(process.cwd(), runDir));

      if (result.valid) {
        console.log(`Hash chain valid (${result.checkedEvents} events checked).`);
        return;
      }

      console.error(`Hash chain invalid: ${result.error}`);
      process.exitCode = 1;
    });
}
