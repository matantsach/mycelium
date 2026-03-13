import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initMissionDir, writeMissionFile } from "../../protocol/mission.js";

describe("context-loader hook", () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    mkdirSync(join(tmpBase, "missions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("shows active missions from filesystem", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, {
      id: "m1",
      status: "active",
      created_at: Date.now(),
    }, "Test mission goal");

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output).toContain("m1");
    expect(output).toContain("Test mission goal");
  });

  it("skips completed missions", () => {
    const mPath = join(tmpBase, "missions", "m1");
    initMissionDir(mPath);
    writeMissionFile(mPath, {
      id: "m1",
      status: "completed",
      created_at: Date.now(),
    }, "Done mission");

    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output.trim()).toBe("");
  });

  it("is silent when no missions exist", () => {
    const output = execSync(`npx tsx src/hooks/context-loader.ts`, {
      encoding: "utf-8",
      cwd: "/Users/matantsach/mtsach/projects/mycelium",
      env: { ...process.env, MYCELIUM_BASE_PATH: tmpBase },
    });
    expect(output.trim()).toBe("");
  });
});
