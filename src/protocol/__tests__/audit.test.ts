import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appendAuditEntry } from "../audit.js";
import type { AuditEntry } from "../audit.js";

describe("appendAuditEntry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-audit-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates audit.jsonl and appends entry", () => {
    const entry: AuditEntry = {
      ts: 1741000001,
      agent: "lead",
      action: "mission_create",
      detail: "Test mission",
    };
    appendAuditEntry(tmpDir, entry);

    const content = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.ts).toBe(1741000001);
    expect(parsed.agent).toBe("lead");
    expect(parsed.action).toBe("mission_create");
    expect(parsed.detail).toBe("Test mission");
  });

  it("appends multiple entries as separate lines", () => {
    appendAuditEntry(tmpDir, { ts: 1, agent: "a", action: "x" });
    appendAuditEntry(tmpDir, { ts: 2, agent: "b", action: "y" });

    const lines = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).ts).toBe(1);
    expect(JSON.parse(lines[1]).ts).toBe(2);
  });

  it("includes optional task_id when provided", () => {
    appendAuditEntry(tmpDir, {
      ts: 1,
      agent: "arm-1",
      action: "task_claim",
      task_id: 3,
    });

    const content = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8");
    expect(JSON.parse(content.trim()).task_id).toBe(3);
  });

  it("omits undefined optional fields", () => {
    appendAuditEntry(tmpDir, { ts: 1, agent: "a", action: "x" });

    const content = readFileSync(join(tmpDir, "audit.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed).not.toHaveProperty("task_id");
    expect(parsed).not.toHaveProperty("detail");
  });
});
