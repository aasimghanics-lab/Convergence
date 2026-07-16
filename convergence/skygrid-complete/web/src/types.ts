export type Aircraft = {
  id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  heading: number; altitude: number; speed: number; version: number; shard: string;
};
export type Shard = { id: string; healthy: boolean; lastHeartbeat: string; aircraft: number };
export type Snapshot = { type: "snapshot"; aircraft: Aircraft[]; shards: Shard[]; timestamp: string };
export type ReplayEvent = { type: string; shard?: string; aircraft?: Aircraft; id?: number; version?: number; at: string };
