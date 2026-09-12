// src/types/scenario.ts
//
// Типы сценария — 1-в-1 со схемой "cosmo-A-1.0", подтверждённой построчным
// чтением backend/geometry.py (validate()) и реальными файлами data/*.json.
// Ключи снизу — snake_case, СОВПАДАЮЩИЕ с бэкендом: Pydantic отклонит запрос
// при малейшем расхождении (camelCase, лишние/недостающие поля).

export type LaunchStage = 1 | 2 | 3;
export type GroundRole = 'client' | 'gateway';

export interface Environment {
  altitude_km: number;
  inclination_deg: number;
  earth_angle0_deg: number;
  horizon_s: number;
  step_s: number;
  min_elevation_deg: number;
  isl_range_km: number;
  target_availability: number;
}

export interface DesignPlane {
  id: string;
  raan_deg: number;
  phase_deg: number;
}

export interface DesignSatellite {
  id: string;
  plane_id: string;
  slot_deg: number;
  launch_batch: LaunchStage;
}

export interface Design {
  launch_stage: LaunchStage;
  planes: DesignPlane[];
  satellites: DesignSatellite[];
}

export interface GroundSite {
  id: string;
  name: string;
  role: GroundRole;
  lat_deg: number;
  lon_deg: number;
}

export interface Failure {
  satellite_id: string;
  start_s: number;
  end_s: number;
}

export interface GatewayOutage {
  gateway_id: string;
  start_s: number;
  end_s: number;
}

export interface ScenarioMeta {
  id: string;
  title: string;
}

export interface Scenario {
  schema_version: 'cosmo-A-1.0';
  meta: ScenarioMeta;
  environment: Environment;
  design: Design;
  ground_sites: GroundSite[];
  failures: Failure[];
  gateway_outages: GatewayOutage[];
}

/** Тело POST /api/update-config — частичное обновление активного сценария. */
export interface ConfigUpdate {
  launch_stage?: LaunchStage;
  isl_range_km?: number;
  planes_update?: Array<{ id: string; raan_deg?: number; phase_deg?: number }>;
  failures_update?: Failure[];
}
