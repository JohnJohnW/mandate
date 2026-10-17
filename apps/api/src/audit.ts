import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditStore } from "@mandate/core";

/** Append-only JSONL file store for the hash-chained audit log. */
export class FileAuditStore implements AuditStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) appendFileSync(path, "");
  }
  readAll(): string[] {
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
  }
  append(line: string): void {
    appendFileSync(this.path, line + "\n");
  }
}
