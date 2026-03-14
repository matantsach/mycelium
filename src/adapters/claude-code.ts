import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { RuntimeAdapter, SpawnConfig } from "./types.js";

export class ClaudeCodeAdapter implements RuntimeAdapter {
  readonly name = "claude-code";
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  isAvailable(): boolean {
    return existsSync(
      join(this.projectRoot, "scripts", "spawn-teammate-claude.sh")
    );
  }

  async spawn(config: SpawnConfig): Promise<void> {
    const scriptPath = join(
      this.projectRoot,
      "scripts",
      "spawn-teammate-claude.sh"
    );
    if (!existsSync(scriptPath)) {
      throw new Error("spawn-teammate-claude.sh not found at " + scriptPath);
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
