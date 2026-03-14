import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { RuntimeAdapter, SpawnConfig } from "./types.js";

export class CodexCliAdapter implements RuntimeAdapter {
  readonly name = "codex-cli";
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  isAvailable(): boolean {
    return existsSync(
      join(this.projectRoot, "scripts", "spawn-teammate-codex.sh")
    );
  }

  async spawn(config: SpawnConfig): Promise<void> {
    const scriptPath = join(
      this.projectRoot,
      "scripts",
      "spawn-teammate-codex.sh"
    );
    if (!existsSync(scriptPath)) {
      throw new Error("spawn-teammate-codex.sh not found at " + scriptPath);
    }

    const env = {
      ...process.env,
      MYCELIUM_AGENT_ID: config.agentId,
      MYCELIUM_MISSION_ID: config.missionId,
      MYCELIUM_PROJECT_ROOT: this.projectRoot,
      ...config.env,
    };

    const result = execSync(
      `bash "${scriptPath}" "${config.missionId}" "${config.agentId}" "${config.taskRef}"`,
      { cwd: this.projectRoot, env, encoding: "utf-8", timeout: 10000 }
    );

    if (result.includes("NOT_IN_TMUX")) {
      throw new Error("tmux not available — cannot spawn teammate");
    }
  }
}
