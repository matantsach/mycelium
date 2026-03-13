import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const DEFAULT_BASE_PATH = join(homedir(), ".mycelium");

const BASE_DIRS = [
  "missions",
  "knowledge",
  "knowledge/repos",
  "templates",
  "adapters",
];

export function initBasePath(basePath: string): void {
  for (const dir of BASE_DIRS) {
    mkdirSync(join(basePath, dir), { recursive: true });
  }
}

export function resolveMissionPath(
  basePath: string,
  missionId: string
): string {
  return join(basePath, "missions", missionId);
}
