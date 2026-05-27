import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashEvent, type HashableEvent } from "./hashChain.js";

export type BlackboxEventType =
  | "run.start"
  | "run.end"
  | "command.start"
  | "command.output"
  | "command.exit"
  | "test.start"
  | "test.output"
  | "test.exit"
  | "file.added"
  | "file.changed"
  | "file.deleted"
  | "policy.violation"
  | "report.generated";

export type BlackboxEvent = HashableEvent & {
  hash: string;
};

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }

  if (value && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        cleaned[key] = stripUndefined(item);
      }
    }
    return cleaned;
  }

  return value;
}

export class EventWriter {
  private seq = 0;
  private prevHash = "GENESIS";
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly eventsPath: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.eventsPath), { recursive: true });
    await writeFile(this.eventsPath, "", { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") {
        throw error;
      }
      await writeFile(this.eventsPath, "");
    });
  }

  async emit(type: BlackboxEventType, data: Record<string, unknown> = {}): Promise<BlackboxEvent> {
    let emittedEvent: BlackboxEvent | undefined;
    const task = this.queue.then(async () => {
      const cleanData = stripUndefined(data) as Record<string, unknown>;
      const baseEvent: HashableEvent = {
        seq: this.seq + 1,
        timestamp: new Date().toISOString(),
        type,
        data: cleanData,
        prevHash: this.prevHash,
      };
      const event: BlackboxEvent = {
        ...baseEvent,
        hash: hashEvent(baseEvent),
      };

      await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`);
      this.seq = event.seq;
      this.prevHash = event.hash;
      emittedEvent = event;
    });

    this.queue = task.catch(() => undefined);
    await task;

    if (!emittedEvent) {
      throw new Error("Failed to emit event");
    }

    return emittedEvent;
  }
}

export async function readEvents(eventsPath: string): Promise<BlackboxEvent[]> {
  const content = await readFile(eventsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BlackboxEvent);
}
