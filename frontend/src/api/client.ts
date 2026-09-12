// src/api/client.ts
//
// Единая точка входа для всех запросов к бэкенду CosmoSats. Переключение
// между мок-движком (src/api/mock/engine.ts) и реальным API — через
// VITE_USE_MOCK в .env.local. Компоненты обращаются только к функциям этого
// файла, а не к fetch напрямую.
//
// Контракт бэкенда — ОДИН активный сценарий в памяти (current_scenario) +
// именованные сохранённые варианты (saved_variants), а не REST-ресурсы по id
// (см. CLAUDE.md, раздел "Реальный контракт бэкенда").

import type { ConfigUpdate, Scenario, ScenarioMeta } from '../types/scenario';
import type { SnapshotResponse } from '../types/network-state';
import type {
  AnalysisResult,
  AutoTuneResult,
  CompareResult,
  RobustnessResult,
} from '../types/analysis';
import {
  compareScenarios,
  computeSnapshotResponse,
  mockAutoTune,
  mockRobustness,
  mockState,
  runFullSimulation,
} from './mock/engine';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `${path}: HTTP ${res.status}`);
  }
  return res.json();
}

/** Загружает один из bundled демо-сценариев (public/sample-scenarios/) — не
 *  завязано на mock/real переключатель, это просто локальный JSON-файл,
 *  который затем передаётся в loadScenario(). */
export async function fetchSampleScenario(file: string): Promise<Scenario> {
  const res = await fetch(file);
  if (!res.ok) throw new Error(`Не удалось загрузить пример сценария ${file}: ${res.status}`);
  return res.json();
}

export async function loadScenario(
  scenario: Scenario,
): Promise<{ status: string; meta: ScenarioMeta }> {
  if (USE_MOCK) {
    mockState.load(scenario);
    return { status: 'success', meta: scenario.meta };
  }
  return request('/api/load', {
    method: 'POST',
    body: JSON.stringify({ scenario_data: scenario }),
  });
}

export async function updateConfig(
  update: ConfigUpdate,
): Promise<{ status: string; scenario: Scenario }> {
  if (USE_MOCK) {
    const scenario = mockState.updateConfig(update);
    return { status: 'updated', scenario };
  }
  return request('/api/update-config', { method: 'POST', body: JSON.stringify(update) });
}

export async function getSnapshot(t_s: number): Promise<SnapshotResponse> {
  if (USE_MOCK) return computeSnapshotResponse(mockState.requireCurrent(), t_s);
  return request(`/api/snapshot/${t_s}`);
}

export async function saveVariant(name: string): Promise<{ status: string; variant: string }> {
  if (USE_MOCK) {
    mockState.saveVariant(name);
    return { status: 'saved', variant: name };
  }
  return request(`/api/save-variant/${encodeURIComponent(name)}`, { method: 'POST' });
}

export async function compareVariants(name1: string, name2: string): Promise<CompareResult> {
  if (USE_MOCK) {
    const res1 = runFullSimulation(mockState.getVariant(name1));
    const res2 = runFullSimulation(mockState.getVariant(name2));
    return compareScenarios(res1, res2);
  }
  return request(`/api/compare/${encodeURIComponent(name1)}/${encodeURIComponent(name2)}`);
}

export async function getAnalysis(): Promise<AnalysisResult> {
  if (USE_MOCK) return runFullSimulation(mockState.requireCurrent());
  return request('/api/analysis');
}

export async function getRobustness(branch = 1): Promise<RobustnessResult> {
  if (USE_MOCK) return mockRobustness(mockState.requireCurrent());
  return request(`/api/robustness?branch=${branch}`);
}

export async function getAutoTune(randomSamples = 10, seed = 42): Promise<AutoTuneResult> {
  if (USE_MOCK) return mockAutoTune(mockState.requireCurrent(), seed);
  return request(`/api/auto-tune?random_samples=${randomSamples}&seed=${seed}`);
}

/** Экспорт — в реальном режиме это прямые ссылки на файловые эндпоинты
 *  бэкенда (см. main.py), в моке экспорт недоступен (нет файлового сервера). */
export function exportAnalysisUrl(): string | null {
  return USE_MOCK ? null : `${API_BASE_URL}/api/export`;
}

export function exportVariantUrl(name: string): string | null {
  return USE_MOCK ? null : `${API_BASE_URL}/api/export/variant/${encodeURIComponent(name)}`;
}

export function exportCompareUrl(name1: string, name2: string): string | null {
  return USE_MOCK
    ? null
    : `${API_BASE_URL}/api/export/compare/${encodeURIComponent(name1)}/${encodeURIComponent(name2)}`;
}

export const isMockMode = USE_MOCK;
