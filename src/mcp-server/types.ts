import { z } from "zod";

export const agentIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(50);

export type MissionStatus = "active" | "completed" | "stopped";
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "needs_review";
export type MemberRole = "lead" | "teammate";
export type MemberStatus = "active" | "idle" | "finished";

export interface Mission {
  id: string;
  status: MissionStatus;
  lead_agent_id: string;
  created_at: number;
}

export interface Task {
  mission_id: string;
  task_id: number;
  status: TaskStatus;
  assigned_to: string | null;
  blocked_by: number[];
  claimed_at: number | null;
  completed_at: number | null;
}

export interface Approval {
  mission_id: string;
  task_id: number;
  decided_by: string;
  decision: "approved" | "rejected";
  feedback: string | null;
  decided_at: number;
}
