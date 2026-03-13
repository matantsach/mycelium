import type { RuntimeAdapter } from "./types.js";
import { CopilotCliAdapter } from "./copilot-cli.js";

export function getAdapter(name: string, projectRoot: string): RuntimeAdapter {
  switch (name) {
    case "copilot-cli":
      return new CopilotCliAdapter(projectRoot);
    default:
      throw new Error(`Unknown runtime adapter: ${name}`);
  }
}
