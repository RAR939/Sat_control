// src/types/analysis.ts
//
// Типы для GET /api/analysis, /api/robustness, /api/auto-tune и
// GET /api/compare/{name1}/{name2} — проверено построчно по
// backend/analyzer.py, backend/router.py, backend/resilience.py,
// backend/optimization.py.

import type { Scenario } from './scenario';

/** Точный порядок проверки в router.evaluate_and_repair_route:
 *  OK/REBUILT — рабочий маршрут; остальные — причина обрыва, в порядке
 *  NO_VISIBLE_SATELLITE -> GATEWAY_UNAVAILABLE -> NO_GATEWAY_CONNECTION ->
 *  BROKEN_ISL_NETWORK. */
export type RouteStatus =
  | 'OK'
  | 'REBUILT'
  | 'NO_VISIBLE_SATELLITE'
  | 'GATEWAY_UNAVAILABLE'
  | 'NO_GATEWAY_CONNECTION'
  | 'BROKEN_ISL_NETWORK';

export interface OutageBreak {
  start_s: number;
  end_s: number;
  duration_s: number;
  reason: RouteStatus;
}

export interface SnapshotSummary {
  edges_count: number;
  visible_satellites: string[];
}

export interface GlobalState {
  t_s: number;
  connected: boolean;
  path: string[];
  active_satellites_count: number;
  status: RouteStatus;
  snapshot_summary: SnapshotSummary;
}

export interface ClientAnalysis {
  availability_pct: number;
  max_break_s: number;
  target_met: boolean;
  breaks: OutageBreak[];
  global_states: GlobalState[];
}

/** Плоский лог по каждому шагу времени x каждому клиенту — НЕ словарь. */
export interface RouteLogEntry {
  t_s: number;
  client_id: string;
  path: string[];
}

export interface AnalysisResult {
  schema_version: 'cosmo-A-result-1.0';
  effective_scenario: Scenario;
  analysis: Record<string, ClientAnalysis>;
  routes: RouteLogEntry[];
}

export interface CompareEntry {
  availability_diff_pct: number;
  max_break_diff_s: number;
  scenario_1_avail: number;
  scenario_2_avail: number;
}

export interface CompareResult {
  variant_1: Record<string, ClientAnalysis>;
  variant_2: Record<string, ClientAnalysis>;
  comparison: Record<string, CompareEntry>;
}

/** satellite_ids — МАССИВ: при branch=1 из одного элемента, при branch>=2 —
 *  комбинация одновременно отказавших спутников. */
export interface RobustnessEntry {
  satellite_ids: string[];
  worst_case_availability_drop_pct: number;
  baseline_min_availability_pct: number;
  degraded_min_availability_pct: number;
  per_client_drop_pct: Record<string, number>;
  causes_full_outage: boolean;
}

export interface RobustnessResult {
  robustness_rating: RobustnessEntry[];
}

/** planes — СЛОВАРЬ {plane_id: {...}}, не массив как в design.planes. */
export interface AutoTuneBest {
  planes: Record<string, { raan_deg: number; phase_deg: number }>;
  min_availability_pct: number;
  mean_availability_pct: number;
  per_client_availability_pct: Record<string, number>;
  baseline_min_availability_pct: number;
  improvement_over_baseline_pct: number;
  evaluations_count: number;
}

export interface AutoTuneResult {
  best_configuration: AutoTuneBest;
}
