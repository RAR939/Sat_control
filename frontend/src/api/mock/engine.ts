// src/api/mock/engine.ts
//
// Мок-движок для VITE_USE_MOCK=true — компактный TS-порт реальной физики и
// роутинга бэкенда (backend/geometry.py, backend/router.py, backend/analyzer.py),
// чтобы фронт можно было верстать и проверять без поднятого Python-бэкенда.
// Все формулы скопированы построчно из исходников бэкенда — НЕ бэкенд сам по
// себе (его мы не трогаем), а его модель, воспроизведённая на фронте.
//
// robustness/auto-tune используют тот же runFullSimulation, что и настоящий
// бэкенд (resilience.py/optimization.py), но с сильно урезанным бюджетом
// прогонов — это мок для разработки UI, а не замена реальному расчёту.

import type { ConfigUpdate, Design, DesignPlane, Scenario } from '../../types/scenario';
import type {
  EdgeTuple,
  GatewayStatus,
  Snapshot,
  SnapshotResponse,
} from '../../types/network-state';
import type {
  AnalysisResult,
  AutoTuneResult,
  ClientAnalysis,
  CompareResult,
  GlobalState,
  RobustnessResult,
  RouteLogEntry,
  RouteStatus,
} from '../../types/analysis';

const R = 6371.0;
const MU = 398600.435507;
const OMEGA = (2 * Math.PI) / 86164.09054;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function positions(scenario: Scenario, t_s: number): { ids: string[]; xyz: Vec3[] } {
  const { environment: e, design: d } = scenario;
  const planeMap = new Map<string, DesignPlane>(d.planes.map((p) => [p.id, p]));
  const r = R + e.altitude_km;
  const n = Math.sqrt(MU / r ** 3);
  const inc = (e.inclination_deg * Math.PI) / 180;
  const th = (e.earth_angle0_deg * Math.PI) / 180 + OMEGA * t_s;
  const c = Math.cos(th);
  const s = Math.sin(th);

  const ids: string[] = [];
  const xyz: Vec3[] = [];
  for (const sat of d.satellites) {
    const plane = planeMap.get(sat.plane_id);
    if (!plane) continue;
    const u = ((sat.slot_deg + plane.phase_deg) * Math.PI) / 180 + n * t_s;
    const om = (plane.raan_deg * Math.PI) / 180;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const co = Math.cos(om);
    const so = Math.sin(om);
    const ox = r * (co * cu - so * su * Math.cos(inc));
    const oy = r * (so * cu + co * su * Math.cos(inc));
    const oz = r * (su * Math.sin(inc));
    // Поворот орбитальной системы в Earth-fixed по -th (см. geo.ts).
    ids.push(sat.id);
    xyz.push({ x: ox * c + oy * s, y: -ox * s + oy * c, z: oz });
  }
  return { ids, xyz };
}

function groundPosition(latDeg: number, lonDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return {
    x: R * Math.cos(lat) * Math.cos(lon),
    y: R * Math.cos(lat) * Math.sin(lon),
    z: R * Math.sin(lat),
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));

export function computeSnapshot(
  scenario: Scenario,
  t_s: number,
  overrideIslRange?: number,
  customFailures?: Scenario['failures'],
): Snapshot {
  const { environment: e, design: d } = scenario;
  const islRange = overrideIslRange ?? e.isl_range_km;
  const { ids, xyz } = positions(scenario, t_s);

  const activeFailures = customFailures ?? scenario.failures;
  const failed = new Set(
    activeFailures.filter((f) => f.start_s <= t_s && t_s < f.end_s).map((f) => f.satellite_id),
  );
  const active = d.satellites
    .filter((sat) => ids.includes(sat.id))
    .map((sat) => sat.launch_batch <= d.launch_stage && !failed.has(sat.id));

  const edges: EdgeTuple[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!active[i] || !active[j]) continue;
      const delta = sub(xyz[j], xyz[i]);
      const dist = norm(delta);
      if (dist >= islRange) continue;
      const denom = dot(delta, delta);
      const lam = Math.max(0, Math.min(1, -dot(xyz[i], delta) / Math.max(denom, 1e-12)));
      const closest = norm({
        x: xyz[i].x + lam * delta.x,
        y: xyz[i].y + lam * delta.y,
        z: xyz[i].z + lam * delta.z,
      });
      if (closest > R) edges.push([ids[i], ids[j], dist]);
    }
  }

  const elevation_deg: Snapshot['elevation_deg'] = {};
  const visible_sats: Snapshot['visible_sats'] = {};
  const gateway_status: Record<string, GatewayStatus> = {};

  for (const g of scenario.ground_sites) {
    const gp = groundPosition(g.lat_deg, g.lon_deg);
    const gpUnit = { x: gp.x / R, y: gp.y / R, z: gp.z / R };
    const elByIdx: number[] = [];
    for (let k = 0; k < ids.length; k++) {
      const dif = sub(xyz[k], gp);
      const dl = norm(dif);
      const sinEl = Math.max(-1, Math.min(1, dot(dif, gpUnit) / dl));
      elByIdx.push((Math.asin(sinEl) * 180) / Math.PI);
    }
    elevation_deg[g.id] = {};
    ids.forEach((sid, k) => {
      if (active[k]) elevation_deg[g.id][sid] = elByIdx[k];
    });

    const offline = scenario.gateway_outages.some(
      (o) => o.gateway_id === g.id && o.start_s <= t_s && t_s < o.end_s,
    );
    const visGeo = ids.map((_, k) => active[k] && elByIdx[k] >= e.min_elevation_deg);
    const vis = visGeo.map((v) => v && !offline);
    const visIds = ids.filter((_, k) => vis[k]);

    if (g.role === 'client') visible_sats[g.id] = visIds;
    if (g.role === 'gateway') {
      gateway_status[g.id] = { outage: offline, geometrically_reachable: visGeo.some(Boolean) };
    }
    ids.forEach((sid, k) => {
      if (vis[k]) edges.push([g.id, sid, norm(sub(xyz[k], gp))]);
    });
  }

  return {
    t_s,
    satellites: ids.map((id, k) => ({
      id,
      x_km: xyz[k].x,
      y_km: xyz[k].y,
      z_km: xyz[k].z,
      active: active[k],
    })),
    edges,
    elevation_deg,
    visible_sats,
    gateway_status,
  };
}

function findPathBfs(
  edges: EdgeTuple[],
  start: string,
  target: string,
  activeSats: Set<string>,
): string[] {
  const adjacency = new Map<string, string[]>();
  for (const [u, v] of edges) {
    if (!adjacency.has(u)) adjacency.set(u, []);
    if (!adjacency.has(v)) adjacency.set(v, []);
    adjacency.get(u)!.push(v);
    adjacency.get(v)!.push(u);
  }
  if (!adjacency.has(start) || !adjacency.has(target)) return [];

  const queue: string[][] = [[start]];
  const visited = new Set([start]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const node = path[path.length - 1];
    if (node === target) return path;
    for (const neighbor of adjacency.get(node) ?? []) {
      if (visited.has(neighbor)) continue;
      if (neighbor === target || activeSats.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return [];
}

function evaluateAndRepairRoute(
  snap: Snapshot,
  client: string,
  gateway: string,
  activeSats: Set<string>,
  existingPath: string[],
): [string[], RouteStatus] {
  const edgeSet = new Set<string>();
  for (const [u, v] of snap.edges) {
    edgeSet.add(`${u}|${v}`);
    edgeSet.add(`${v}|${u}`);
  }

  let isValid =
    existingPath.length > 0 &&
    existingPath[0] === client &&
    existingPath[existingPath.length - 1] === gateway;
  if (isValid) {
    for (let i = 0; i < existingPath.length - 1; i++) {
      const u = existingPath[i];
      const v = existingPath[i + 1];
      if (!edgeSet.has(`${u}|${v}`)) {
        isValid = false;
        break;
      }
      if (u !== client && !activeSats.has(u)) {
        isValid = false;
        break;
      }
      if (v !== gateway && !activeSats.has(v)) {
        isValid = false;
        break;
      }
    }
  }
  if (isValid) return [existingPath, 'OK'];

  const newPath = findPathBfs(snap.edges, client, gateway, activeSats);
  if (newPath.length > 0) return [newPath, 'REBUILT'];

  const visibleSats = snap.visible_sats[client] ?? [];
  if (visibleSats.length === 0) return [[], 'NO_VISIBLE_SATELLITE'];

  const gwStatus = snap.gateway_status[gateway];
  if (gwStatus?.outage) return [[], 'GATEWAY_UNAVAILABLE'];
  if (!gwStatus?.geometrically_reachable) return [[], 'NO_GATEWAY_CONNECTION'];

  return [[], 'BROKEN_ISL_NETWORK'];
}

function computeRoutesForSnapshot(
  snap: Snapshot,
  clients: string[],
  gateway: string,
  activeSats: Set<string>,
  previousRoutes: Record<string, string[]>,
): { routes: Record<string, string[]>; status: Record<string, RouteStatus> } {
  const routes: Record<string, string[]> = {};
  const status: Record<string, RouteStatus> = {};
  for (const client of clients) {
    const [path, s] = evaluateAndRepairRoute(
      snap,
      client,
      gateway,
      activeSats,
      previousRoutes[client] ?? [],
    );
    routes[client] = path;
    status[client] = s;
  }
  return { routes, status };
}

export function computeSnapshotResponse(scenario: Scenario, t_s: number): SnapshotResponse {
  const snap = computeSnapshot(scenario, t_s);
  const gateways = scenario.ground_sites.filter((g) => g.role === 'gateway').map((g) => g.id);
  const clients = scenario.ground_sites.filter((g) => g.role === 'client').map((g) => g.id);
  const activeSats = new Set(snap.satellites.filter((s) => s.active).map((s) => s.id));
  const routes = gateways[0]
    ? computeRoutesForSnapshot(snap, clients, gateways[0], activeSats, {}).routes
    : {};
  return { snapshot: snap, routes, visible_satellites_per_client: snap.visible_sats };
}

export function runFullSimulation(scenario: Scenario): AnalysisResult {
  const { environment: env } = scenario;
  const times: number[] = [];
  for (let t = 0; t < env.horizon_s; t += env.step_s) times.push(t);

  const clients = scenario.ground_sites.filter((g) => g.role === 'client').map((g) => g.id);
  const gateways = scenario.ground_sites.filter((g) => g.role === 'gateway').map((g) => g.id);
  const gw = gateways[0];

  const globalStates: Record<string, GlobalState[]> = Object.fromEntries(
    clients.map((c) => [c, []]),
  );
  const breaksHistory: Record<string, ClientAnalysis['breaks']> = Object.fromEntries(
    clients.map((c) => [c, []]),
  );
  const connectedCount: Record<string, number> = Object.fromEntries(clients.map((c) => [c, 0]));
  const breakStart: Record<string, number | null> = Object.fromEntries(
    clients.map((c) => [c, null]),
  );
  const breakReason: Record<string, RouteStatus | null> = Object.fromEntries(
    clients.map((c) => [c, null]),
  );

  const allRoutesLog: RouteLogEntry[] = [];
  let prevRoutes: Record<string, string[]> = {};

  for (const t of times) {
    const snap = computeSnapshot(scenario, t);
    const activeSats = new Set(snap.satellites.filter((s) => s.active).map((s) => s.id));
    let routes: Record<string, string[]> = {};
    let status: Record<string, RouteStatus> = {};
    if (gw) {
      const result = computeRoutesForSnapshot(snap, clients, gw, activeSats, prevRoutes);
      routes = result.routes;
      status = result.status;
      prevRoutes = routes;
    }

    for (const c of clients) {
      const path = routes[c] ?? [];
      const st = status[c] ?? 'NO_VISIBLE_SATELLITE';
      const hasConnection = path.length > 0;

      globalStates[c].push({
        t_s: t,
        connected: hasConnection,
        path,
        active_satellites_count: activeSats.size,
        status: st,
        snapshot_summary: {
          edges_count: snap.edges.length,
          visible_satellites: snap.visible_sats[c] ?? [],
        },
      });

      if (hasConnection) {
        connectedCount[c] += 1;
        const start = breakStart[c];
        if (start !== null) {
          const duration = t - start;
          breaksHistory[c].push({
            start_s: start,
            end_s: t,
            duration_s: duration,
            reason: breakReason[c]!,
          });
          breakStart[c] = null;
          breakReason[c] = null;
        }
      } else if (breakStart[c] === null) {
        breakStart[c] = t;
        breakReason[c] = st;
      }
    }

    for (const [c, path] of Object.entries(routes))
      allRoutesLog.push({ t_s: t, client_id: c, path });
  }

  const totalSteps = times.length;
  const analysis: Record<string, ClientAnalysis> = {};
  for (const c of clients) {
    if (breakStart[c] !== null) {
      const duration = env.horizon_s - breakStart[c]!;
      breaksHistory[c].push({
        start_s: breakStart[c]!,
        end_s: env.horizon_s,
        duration_s: duration,
        reason: breakReason[c]!,
      });
    }
    const maxBreak = breaksHistory[c].reduce((m, b) => Math.max(m, b.duration_s), 0);
    const availability = totalSteps > 0 ? connectedCount[c] / totalSteps : 0;
    analysis[c] = {
      availability_pct: availability * 100,
      max_break_s: maxBreak,
      target_met: availability >= env.target_availability,
      breaks: breaksHistory[c],
      global_states: globalStates[c],
    };
  }

  return {
    schema_version: 'cosmo-A-result-1.0',
    effective_scenario: scenario,
    analysis,
    routes: allRoutesLog,
  };
}

export function compareScenarios(res1: AnalysisResult, res2: AnalysisResult): CompareResult {
  const comparison: CompareResult['comparison'] = {};
  for (const c of Object.keys(res1.analysis)) {
    const a1 = res1.analysis[c].availability_pct;
    const a2 = res2.analysis[c]?.availability_pct ?? 0;
    const mb1 = res1.analysis[c].max_break_s;
    const mb2 = res2.analysis[c]?.max_break_s ?? 0;
    comparison[c] = {
      availability_diff_pct: a2 - a1,
      max_break_diff_s: mb2 - mb1,
      scenario_1_avail: a1,
      scenario_2_avail: a2,
    };
  }
  return { variant_1: res1.analysis, variant_2: res2.analysis, comparison };
}

function minAvailability(res: AnalysisResult): number {
  const values = Object.values(res.analysis).map((a) => a.availability_pct / 100);
  return values.length > 0 ? Math.min(...values) : 1;
}

/** Мок-версия resilience.py: отказ ОДНОГО спутника за раз (branch>1 не
 *  поддержан в моке — это только для разработки UI, точный расчёт даёт
 *  реальный бэкенд). Бюджет: по одному полному прогону на активный спутник. */
export function mockRobustness(scenario: Scenario): RobustnessResult {
  const baseline = runFullSimulation(scenario);
  const baselineAvail = Object.fromEntries(
    Object.entries(baseline.analysis).map(([c, a]) => [c, a.availability_pct / 100]),
  );
  const baselineMin = minAvailability(baseline);

  const activeIds = scenario.design.satellites
    .filter((s) => s.launch_batch <= scenario.design.launch_stage)
    .map((s) => s.id);

  const rating = activeIds.map((sid) => {
    const degraded: Scenario = {
      ...scenario,
      failures: [
        ...scenario.failures,
        { satellite_id: sid, start_s: 0, end_s: scenario.environment.horizon_s },
      ],
    };
    const result = runFullSimulation(degraded);
    const degradedMin = minAvailability(result);
    const perClientDrop = Object.fromEntries(
      Object.keys(baselineAvail).map((c) => [
        c,
        (baselineAvail[c] - (result.analysis[c]?.availability_pct ?? 0) / 100) * 100,
      ]),
    );
    return {
      satellite_ids: [sid],
      worst_case_availability_drop_pct: (baselineMin - degradedMin) * 100,
      baseline_min_availability_pct: baselineMin * 100,
      degraded_min_availability_pct: degradedMin * 100,
      per_client_drop_pct: perClientDrop,
      causes_full_outage: degradedMin === 0,
    };
  });

  rating.sort((a, b) => b.worst_case_availability_drop_pct - a.worst_case_availability_drop_pct);
  return { robustness_rating: rating };
}

type Configuration = Record<string, { raan_deg: number; phase_deg: number }>;

function applyConfiguration(scenario: Scenario, config: Configuration): Scenario {
  const planes: DesignPlane[] = scenario.design.planes.map((p) =>
    config[p.id]
      ? { ...p, raan_deg: config[p.id].raan_deg % 360, phase_deg: config[p.id].phase_deg % 360 }
      : p,
  );
  const design: Design = { ...scenario.design, planes };
  return { ...scenario, design };
}

function evaluateConfig(scenario: Scenario, config: Configuration) {
  const result = runFullSimulation(applyConfiguration(scenario, config));
  const perClient = Object.fromEntries(
    Object.entries(result.analysis).map(([c, a]) => [c, a.availability_pct]),
  );
  const values = Object.values(perClient);
  return {
    config,
    min: values.length > 0 ? Math.min(...values) : 0,
    mean: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
    perClient,
  };
}

/** Мок-версия optimization.py со скромным бюджетом (в разы меньше, чем даже
 *  урезанные дефолты analyzer.auto_tune_configuration) — считается в главном
 *  потоке браузера, а не на сервере, поэтому держим число прогонов минимальным. */
export function mockAutoTune(scenario: Scenario, seed = 42): AutoTuneResult {
  let s = seed;
  const rng = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const planeIds = scenario.design.planes.map((p) => p.id);
  const baselineConfig: Configuration = Object.fromEntries(
    scenario.design.planes.map((p) => [p.id, { raan_deg: p.raan_deg, phase_deg: p.phase_deg }]),
  );
  const baseline = evaluateConfig(scenario, baselineConfig);

  const evaluations = [baseline];
  for (let i = 0; i < 4; i++) {
    const config: Configuration = Object.fromEntries(
      planeIds.map((pid) => [pid, { raan_deg: rng() * 360, phase_deg: rng() * 360 }]),
    );
    evaluations.push(evaluateConfig(scenario, config));
  }

  let best = evaluations.reduce((a, b) =>
    b.min > a.min || (b.min === a.min && b.mean > a.mean) ? b : a,
  );
  const step = 15;
  for (let iter = 0; iter < 3; iter++) {
    let improved = false;
    for (const pid of planeIds) {
      for (const key of ['raan_deg', 'phase_deg'] as const) {
        for (const sign of [1, -1]) {
          const candidateConfig: Configuration = structuredClone(best.config);
          candidateConfig[pid][key] += sign * step;
          const candidate = evaluateConfig(scenario, candidateConfig);
          evaluations.push(candidate);
          if (
            candidate.min > best.min ||
            (candidate.min === best.min && candidate.mean > best.mean)
          ) {
            best = candidate;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }

  return {
    best_configuration: {
      planes: best.config,
      min_availability_pct: best.min,
      mean_availability_pct: best.mean,
      per_client_availability_pct: best.perClient,
      baseline_min_availability_pct: baseline.min,
      improvement_over_baseline_pct: best.min - baseline.min,
      evaluations_count: evaluations.length,
    },
  };
}

/** Мини-хранилище состояния мока — аналог current_scenario/saved_variants
 *  в backend/main.py (тоже глобальное состояние в памяти, не REST по id). */
class MockState {
  current: Scenario | null = null;
  variants = new Map<string, Scenario>();

  load(scenario: Scenario) {
    this.current = scenario;
  }

  updateConfig(update: ConfigUpdate): Scenario {
    if (!this.current) throw new Error('No scenario loaded');
    const next: Scenario = structuredClone(this.current);
    if (update.launch_stage !== undefined) next.design.launch_stage = update.launch_stage;
    if (update.isl_range_km !== undefined) next.environment.isl_range_km = update.isl_range_km;
    if (update.failures_update !== undefined) next.failures = update.failures_update;
    if (update.planes_update !== undefined) {
      const planeMap = new Map(next.design.planes.map((p) => [p.id, p]));
      for (const upd of update.planes_update) {
        const plane = planeMap.get(upd.id);
        if (!plane) continue;
        if (upd.raan_deg !== undefined) plane.raan_deg = ((upd.raan_deg % 360) + 360) % 360;
        if (upd.phase_deg !== undefined) plane.phase_deg = ((upd.phase_deg % 360) + 360) % 360;
      }
    }
    this.current = next;
    return next;
  }

  requireCurrent(): Scenario {
    if (!this.current) throw new Error('No scenario loaded');
    return this.current;
  }

  saveVariant(name: string) {
    this.variants.set(name, structuredClone(this.requireCurrent()));
  }

  getVariant(name: string): Scenario {
    const v = this.variants.get(name);
    if (!v) throw new Error(`Variant not found: ${name}`);
    return v;
  }
}

export const mockState = new MockState();
