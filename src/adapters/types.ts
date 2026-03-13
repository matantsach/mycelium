export interface SpawnConfig {
  missionId: string;
  agentId: string;
  worktreePath: string;
  taskRef: string;
  agentPrompt: string;
  env: Record<string, string>;
}

export interface RuntimeAdapter {
  name: string;
  spawn(config: SpawnConfig): Promise<void>;
  isAvailable(): boolean;
}
