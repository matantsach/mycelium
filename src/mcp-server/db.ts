import { Database } from "node-sqlite3-wasm";
import { randomUUID } from "crypto";
import type { Mission, Task } from "./types.js";

export class TeamDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','stopped')),
        lead_agent_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        mission_id TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','blocked','needs_review')),
        assigned_to TEXT,
        blocked_by TEXT DEFAULT '[]',
        claimed_at INTEGER,
        completed_at INTEGER,
        PRIMARY KEY (mission_id, task_id),
        FOREIGN KEY (mission_id) REFERENCES missions(id)
      );
      CREATE TABLE IF NOT EXISTS approvals (
        mission_id TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        decided_by TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
        feedback TEXT,
        decided_at INTEGER NOT NULL,
        PRIMARY KEY (mission_id, task_id, decided_at)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // --- Missions ---

  createMission(leadAgentId: string): Mission {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    const now = Date.now();
    this.db.run(
      "INSERT INTO missions (id, status, lead_agent_id, created_at) VALUES (?, 'active', ?, ?)",
      [id, leadAgentId, now]
    );
    return { id, status: "active", lead_agent_id: leadAgentId, created_at: now };
  }

  getActiveMission(id: string): Mission {
    const row = this.db.get("SELECT * FROM missions WHERE id = ?", [id]) as unknown as Mission | null;
    if (!row) throw new Error(`Mission '${id}' not found`);
    if (row.status !== "active") throw new Error(`Mission '${id}' is not active (status: ${row.status})`);
    return row;
  }

  // --- Tasks ---

  insertTask(missionId: string, taskId: number, blockedBy: number[]): void {
    const status = blockedBy.length > 0 ? "blocked" : "pending";
    this.db.run(
      "INSERT INTO tasks (mission_id, task_id, status, blocked_by) VALUES (?, ?, ?, ?)",
      [missionId, taskId, status, JSON.stringify(blockedBy)]
    );
  }

  getTask(missionId: string, taskId: number): Task | undefined {
    const row = this.db.get(
      "SELECT * FROM tasks WHERE mission_id = ? AND task_id = ?",
      [missionId, taskId]
    ) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      ...row,
      blocked_by: JSON.parse((row.blocked_by as string) || "[]"),
    } as Task;
  }

  claimTask(missionId: string, taskId: number, agentId: string): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.getTask(missionId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found in mission ${missionId}`);
      if (task.status !== "pending") throw new Error(`Task ${taskId} is ${task.status}, cannot claim`);

      // Check blockers
      if (task.blocked_by.length > 0) {
        for (const bid of task.blocked_by) {
          const blocker = this.getTask(missionId, bid);
          if (blocker && blocker.status !== "completed") {
            throw new Error(`Task ${taskId} is blocked by task ${bid}`);
          }
        }
      }

      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = 'in_progress', assigned_to = ?, claimed_at = ? WHERE mission_id = ? AND task_id = ?",
        [agentId, now, missionId, taskId]
      );
      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  reconcileAndClaimTask(
    missionId: string,
    taskId: number,
    agentId: string,
    fsData?: { blockedBy: number[] }
  ): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let task = this.getTask(missionId, taskId);
      if (!task && fsData) {
        this.insertTask(missionId, taskId, fsData.blockedBy);
        for (const blockerId of fsData.blockedBy) {
          if (!this.getTask(missionId, blockerId)) {
            this.insertTask(missionId, blockerId, []);
          }
        }
        task = this.getTask(missionId, taskId);
      }
      if (!task) throw new Error(`Task ${taskId} not found in mission ${missionId}`);
      if (task.status !== "pending") throw new Error(`Task ${taskId} is ${task.status}, cannot claim`);

      if (task.blocked_by.length > 0) {
        for (const bid of task.blocked_by) {
          const blocker = this.getTask(missionId, bid);
          if (blocker && blocker.status !== "completed") {
            throw new Error(`Task ${taskId} is blocked by task ${bid}`);
          }
        }
      }

      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = 'in_progress', assigned_to = ?, claimed_at = ? WHERE mission_id = ? AND task_id = ?",
        [agentId, now, missionId, taskId]
      );
      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  completeTask(missionId: string, taskId: number, agentId: string, reviewRequired?: boolean): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.getTask(missionId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== "in_progress") throw new Error(`Task ${taskId} is ${task.status}, cannot complete`);
      if (task.assigned_to !== agentId) throw new Error(`Task ${taskId} is assigned to ${task.assigned_to}, not ${agentId}`);

      const newStatus = reviewRequired ? "needs_review" : "completed";
      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = ?, completed_at = ? WHERE mission_id = ? AND task_id = ?",
        [newStatus, now, missionId, taskId]
      );

      // Auto-unblock cascade (only on completed, not needs_review)
      if (newStatus === "completed") {
        this.autoUnblock(missionId, taskId);
      }

      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private autoUnblock(missionId: string, completedTaskId: number): void {
    const allTasks = this.db.all(
      "SELECT * FROM tasks WHERE mission_id = ? AND status = 'blocked'",
      [missionId]
    ) as Array<Record<string, unknown>>;

    for (const row of allTasks) {
      const blockedBy: number[] = JSON.parse((row.blocked_by as string) || "[]");
      if (!blockedBy.includes(completedTaskId)) continue;

      // Check if ALL blockers are completed
      const allResolved = blockedBy.every((bid) => {
        if (bid === completedTaskId) return true;
        const b = this.getTask(missionId, bid);
        return b && b.status === "completed";
      });

      if (allResolved) {
        this.db.run(
          "UPDATE tasks SET status = 'pending' WHERE mission_id = ? AND task_id = ?",
          [missionId, row.task_id as string | number | bigint | null]
        );
      }
    }
  }

  approveTask(missionId: string, taskId: number, agentId: string): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const mission = this.getActiveMission(missionId);
      if (mission.lead_agent_id !== agentId) {
        throw new Error(`Only the lead (${mission.lead_agent_id}) can approve tasks`);
      }
      const task = this.getTask(missionId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== "needs_review") throw new Error(`Task ${taskId} is ${task.status}, cannot approve`);

      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = 'completed', completed_at = ? WHERE mission_id = ? AND task_id = ?",
        [now, missionId, taskId]
      );
      this.db.run(
        "INSERT INTO approvals (mission_id, task_id, decided_by, decision, decided_at) VALUES (?, ?, ?, 'approved', ?)",
        [missionId, taskId, agentId, now]
      );
      this.autoUnblock(missionId, taskId);
      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  rejectTask(missionId: string, taskId: number, agentId: string, feedback: string): Task {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const mission = this.getActiveMission(missionId);
      if (mission.lead_agent_id !== agentId) {
        throw new Error(`Only the lead (${mission.lead_agent_id}) can reject tasks`);
      }
      const task = this.getTask(missionId, taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      if (task.status !== "needs_review") throw new Error(`Task ${taskId} is ${task.status}, cannot reject`);

      const now = Date.now();
      this.db.run(
        "UPDATE tasks SET status = 'in_progress', completed_at = NULL WHERE mission_id = ? AND task_id = ?",
        [missionId, taskId]
      );
      this.db.run(
        "INSERT INTO approvals (mission_id, task_id, decided_by, decision, feedback, decided_at) VALUES (?, ?, ?, 'rejected', ?, ?)",
        [missionId, taskId, agentId, feedback, now]
      );
      this.db.exec("COMMIT");
      return this.getTask(missionId, taskId)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
