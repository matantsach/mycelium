import type { RuntimeAdapter } from "./types.js";
import { CopilotCliAdapter } from "./copilot-cli.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexCliAdapter } from "./codex-cli.js";

export function getAdapter(name: string, projectRoot: string): RuntimeAdapter {
  switch (name) {
    case "copilot-cli":
      return new CopilotCliAdapter(projectRoot);
    case "claude-code":
      return new ClaudeCodeAdapter(projectRoot);
    case "codex-cli":
      return new CodexCliAdapter(projectRoot);
    default:
      throw new Error(`Unknown runtime adapter: ${name}`);
  }
}
