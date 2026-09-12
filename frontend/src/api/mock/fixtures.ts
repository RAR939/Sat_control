// src/api/mock/fixtures.ts
//
// Заглушки данных для разработки фронта без готового бэкенда.
// Структура полностью соответствует типам из src/types — как только бэкенд
// будет готов, эти фикстуры можно использовать и как основу для тестов.

import type { Scenario } from '../../types/scenario';
import type { NetworkState } from '../../types/network-state';
import type { AnalysisSummary } from '../../types/analysis';

export const mockScenario: Scenario = {
  id: 'demo-scenario',
  name: 'Демо-сценарий (48 спутников)',
  durationSeconds: 3600,
  stateStepSeconds: 10,
  islRangeKm: 2000,
  orbitalPlanes: [{ planeId: 'plane-1', raan: 0, phase: 0, satelliteCount: 48 }],
  deploymentStages: [{ stageNumber: 1, startTime: 0, satelliteIds: [] }],
  failures: [],
  groundPoints: [
    { id: 'client-1', type: 'client', name: 'Клиент А', latitude: 55.75, longitude: 37.6 },
    { id: 'gateway-1', type: 'gateway', name: 'Шлюз 1', latitude: 59.9, longitude: 30.3 },
  ],
};

export const mockNetworkState: NetworkState = {
  timestampSeconds: 0,
  satellites: [
    { satelliteId: 'sat-1', status: 'active', latitude: 10, longitude: 20, altitudeKm: 550 },
    { satelliteId: 'sat-2', status: 'failed', latitude: -5, longitude: 45, altitudeKm: 550 },
  ],
  islLinks: [{ fromSatelliteId: 'sat-1', toSatelliteId: 'sat-2' }],
  route: { path: ['client-1', 'sat-1', 'sat-2', 'gateway-1'], exists: true },
};

export const mockAnalysisSummary: AnalysisSummary = {
  scenarioId: 'demo-scenario',
  totalOutages: 2,
  totalOutageDurationSeconds: 120,
  outages: [
    { startTimeSeconds: 300, endTimeSeconds: 360, reason: 'isl_break', affectedIds: ['sat-2'] },
    { startTimeSeconds: 1800, endTimeSeconds: 1860, reason: 'no_gateway', affectedIds: ['gateway-1'] },
  ],
  outageDurationByReason: { no_client: 0, no_gateway: 60, isl_break: 60 },
};