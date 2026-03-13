import { describe, it, expect } from "vitest";
import { CopilotCliAdapter } from "../copilot-cli.js";
import { getAdapter } from "../registry.js";

describe("CopilotCliAdapter", () => {
  it("has name 'copilot-cli'", () => {
    const adapter = new CopilotCliAdapter("/path/to/project");
    expect(adapter.name).toBe("copilot-cli");
  });

  it("isAvailable returns boolean", () => {
    const adapter = new CopilotCliAdapter(process.cwd());
    expect(typeof adapter.isAvailable()).toBe("boolean");
  });
});

describe("getAdapter", () => {
  it("returns CopilotCliAdapter for 'copilot-cli'", () => {
    const adapter = getAdapter("copilot-cli", "/path");
    expect(adapter.name).toBe("copilot-cli");
  });

  it("throws for unknown adapter", () => {
    expect(() => getAdapter("unknown", "/path")).toThrow(
      "Unknown runtime adapter"
    );
  });
});
