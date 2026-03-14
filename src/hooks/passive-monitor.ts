import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Parse a single key from frontmatter using regex — no yaml dependency */
function parseField(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : undefined;
}

/** Check if frontmatter contains `priority: true` */
function hasPriority(content: string): boolean {
  return /^priority:\s*true\s*$/m.test(content);
}

if (agentId) {
  // ── Arm mode ──────────────────────────────────────────────────────────────
  const resolvedMissionId = missionId || "unknown";
  const inboxDir = join(basePath, "missions", resolvedMissionId, "inbox", agentId);

  if (existsSync(inboxDir)) {
    const files = readdirSync(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor" && !f.startsWith(".")
    );

    if (files.length > 0) {
      // Check for priority messages — read content only when needed
      let hasPriorityMsg = false;
      for (const file of files) {
        try {
          const content = readFileSync(join(inboxDir, file), "utf-8");
          if (hasPriority(content)) {
            hasPriorityMsg = true;
            break;
          }
        } catch {
          // skip unreadable files
        }
      }

      if (hasPriorityMsg) {
        console.log("[mycelium] PRIORITY message from lead in inbox");
      } else {
        console.log(`[mycelium] ${files.length} unread message(s) in inbox`);
      }
    }
  }
} else {
  // ── Captain mode ──────────────────────────────────────────────────────────
  const missionsDir = join(basePath, "missions");
  if (!existsSync(missionsDir)) process.exit(0);

  const now = Date.now();
  const entries = readdirSync(missionsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const mPath = join(missionsDir, entry.name);
    const missionFile = join(mPath, "mission.md");
    if (!existsSync(missionFile)) continue;

    let missionContent: string;
    try {
      missionContent = readFileSync(missionFile, "utf-8");
    } catch {
      continue;
    }

    const status = parseField(missionContent, "status");
    if (status !== "active") continue;

    const mId = parseField(missionContent, "id") || entry.name;
    const signals: string[] = [];

    // ── Stale arm detection ────────────────────────────────────────────────
    const membersDir = join(mPath, "members");
    const progressDir = join(mPath, "progress");

    if (existsSync(membersDir)) {
      const memberFiles = readdirSync(membersDir).filter((f) =>
        f.endsWith(".md")
      );

      for (const memberFile of memberFiles) {
        const armId = memberFile.replace(/\.md$/, "");
        let mtime: number | undefined;

        // Prefer progress file mtime
        const progressFile = join(progressDir, `${armId}.md`);
        if (existsSync(progressFile)) {
          try {
            mtime = statSync(progressFile).mtimeMs;
          } catch {
            // fall through
          }
        }

        // Fall back to member file mtime
        if (mtime === undefined) {
          try {
            mtime = statSync(join(membersDir, memberFile)).mtimeMs;
          } catch {
            // skip
          }
        }

        if (mtime !== undefined && now - mtime > STALE_THRESHOLD_MS) {
          signals.push(`stale arm: ${armId}`);
        }
      }
    }

    // ── Task status analysis ────────────────────────────────────────────────
    const tasksDir = join(mPath, "tasks");
    if (existsSync(tasksDir)) {
      const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));

      let allCompleted = taskFiles.length > 0;
      let hasNeedsReview = false;

      for (const taskFile of taskFiles) {
        let taskContent: string;
        try {
          taskContent = readFileSync(join(tasksDir, taskFile), "utf-8");
        } catch {
          allCompleted = false;
          continue;
        }

        const taskStatus = parseField(taskContent, "status");
        if (taskStatus === "needs_review") {
          hasNeedsReview = true;
        }
        if (taskStatus !== "completed") {
          allCompleted = false;
        }
      }

      if (hasNeedsReview) {
        signals.push("task needs review");
      }
      if (allCompleted) {
        signals.push("all tasks complete");
      }
    }

    if (signals.length > 0) {
      console.log(`[mycelium] ${mId}: ${signals.join(" | ")}`);
    }
  }
}
