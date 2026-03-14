import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CodexCliAdapter } from "../codex-cli.js";

describe("CodexCliAdapter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-codex-adapter-"));
    mkdirSync(join(tmpDir, "scripts"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has name 'codex-cli'", () => {
    expect(new CodexCliAdapter(tmpDir).name).toBe("codex-cli");
  });

  it("reports unavailable when spawn script is missing", () => {
    expect(new CodexCliAdapter(tmpDir).isAvailable()).toBe(false);
  });

  it("reports available when spawn script exists", () => {
    const p = join(tmpDir, "scripts", "spawn-teammate-codex.sh");
    writeFileSync(p, "#!/bin/bash\necho test", "utf-8");
    chmodSync(p, "755");
    expect(new CodexCliAdapter(tmpDir).isAvailable()).toBe(true);
  });

  it("throws when spawn script is missing on spawn", async () => {
    await expect(
      new CodexCliAdapter(tmpDir).spawn({
        missionId: "m1",
        agentId: "arm-1",
        worktreePath: "/tmp/wt",
        taskRef: "1",
        agentPrompt: "Do work",
        env: {},
      })
    ).rejects.toThrow("spawn-teammate-codex.sh not found");
  });
});
