// src/api/client.ts
//
// Единая точка входа для всех запросов к бэкенду.
// Переключение между моками и реальным API — через VITE_USE_MOCK в .env.local.
// Это позволяет верстать весь фронт (3D, таймлайн, графики) до готовности
// бэкенда, а потом переключиться на реальный API без изменения компонентов —
// они обращаются только к функциям этого файла, а не к fetch напрямую.

import type { Scenario } from '../types/scenario';
import type { NetworkState } from '../types/network-state';
import type { AnalysisSummary } from '../types/analysis';
import { mockScenario, mockNetworkState, mockAnalysisSummary } from './mock/fixtures';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

/** Искусственная задержка для мок-режима — чтобы сразу видеть лоадеры в UI,
 *  а не только когда подключится настоящая медленная сеть */
const mockDelay = <T>(value: T, ms = 400): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export async function getScenario(scenarioId: string): Promise<Scenario> {
  if (USE_MOCK) return mockDelay(mockScenario);

  const res = await fetch(`${API_BASE_URL}/scenarios/${scenarioId}`);
  if (!res.ok) throw new Error(`Не удалось загрузить сценарий ${scenarioId}: ${res.status}`);
  return res.json();
}

export async function getNetworkState(
  scenarioId: string,
  timestampSeconds: number,
): Promise<NetworkState> {
  if (USE_MOCK) return mockDelay({ ...mockNetworkState, timestampSeconds });

  const res = await fetch(
    `${API_BASE_URL}/scenarios/${scenarioId}/state?t=${timestampSeconds}`,
  );
  if (!res.ok) throw new Error(`Не удалось загрузить состояние на t=${timestampSeconds}`);
  return res.json();
}

export async function getAnalysis(scenarioId: string): Promise<AnalysisSummary> {
  if (USE_MOCK) return mockDelay(mockAnalysisSummary);

  const res = await fetch(`${API_BASE_URL}/scenarios/${scenarioId}/analysis`);
  if (!res.ok) throw new Error(`Не удалось загрузить аналитику для ${scenarioId}`);
  return res.json();
}