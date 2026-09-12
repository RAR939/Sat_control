// src/types/network-state.ts
//
// Ответ GET /api/snapshot/{t_s} — состояние сети на момент времени t_s.
// Проверено построчно по backend/geometry.py и backend/main.py (api_snapshot).

export interface SatelliteSnapshot {
  id: string;
  x_km: number;
  y_km: number;
  z_km: number;
  active: boolean;
}

/** [node_a, node_b, dist_km] — смешаны ISL (спутник-спутник) и линии
 *  видимости земля-спутник в ОДНОМ массиве. Различать по ID: если один из
 *  узлов встречается в ground_sites — это линия видимости, а не ISL. */
export type EdgeTuple = [string, string, number];

export interface GatewayStatus {
  outage: boolean;
  geometrically_reachable: boolean;
}

export interface Snapshot {
  t_s: number;
  satellites: SatelliteSnapshot[];
  edges: EdgeTuple[];
  elevation_deg: Record<string, Record<string, number>>;
  visible_sats: Record<string, string[]>;
  gateway_status: Record<string, GatewayStatus>;
}

/** client_id -> path (пустой массив = маршрута нет). Это СЛОВАРЬ, не массив. */
export type RoutesMap = Record<string, string[]>;

export interface SnapshotResponse {
  snapshot: Snapshot;
  routes: RoutesMap;
  visible_satellites_per_client: Record<string, string[]>;
}
