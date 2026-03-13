import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  initBasePath,
  resolveMissionPath,
  DEFAULT_BASE_PATH,
} from "../dirs.js";

describe("dirs", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("DEFAULT_BASE_PATH points to ~/.mycelium", () => {
    expect(DEFAULT_BASE_PATH).toContain(".mycelium");
  });

  it("initBasePath creates the full directory structure", () => {
    initBasePath(tmpBase);
    expect(existsSync(join(tmpBase, "missions"))).toBe(true);
    expect(existsSync(join(tmpBase, "knowledge"))).toBe(true);
    expect(existsSync(join(tmpBase, "knowledge", "repos"))).toBe(true);
    expect(existsSync(join(tmpBase, "templates"))).toBe(true);
    expect(existsSync(join(tmpBase, "adapters"))).toBe(true);
  });

  it("initBasePath is idempotent", () => {
    initBasePath(tmpBase);
    initBasePath(tmpBase);
    expect(existsSync(join(tmpBase, "missions"))).toBe(true);
  });

  it("resolveMissionPath returns correct path", () => {
    const result = resolveMissionPath(tmpBase, "mission-001");
    expect(result).toBe(join(tmpBase, "missions", "mission-001"));
  });
});
