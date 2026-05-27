import { createHash } from "node:crypto";

export type HashableEvent = {
  seq: number;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
  prevHash: string;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const entries = Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`);

  return `{${entries.join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashEvent(event: HashableEvent): string {
  return sha256(canonicalJson(event));
}
