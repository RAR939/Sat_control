// src/api/hooks.ts
//
// TanStack Query поверх api/client.ts — кэширование, loading/error состояния.
// Любая мутация, меняющая активный сценарий на бэкенде (load/update-config),
// инвалидирует snapshot/analysis/robustness — они все читают ОДИН и тот же
// current_scenario, так что после изменения конфигурации все зависимые
// данные считаются устаревшими.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  compareVariants,
  getAnalysis,
  getAutoTune,
  getRobustness,
  getSnapshot,
  loadScenario,
  saveVariant,
  updateConfig,
} from './client';
import type { ConfigUpdate, Scenario } from '../types/scenario';
import { useScenarioStore } from '../stores/scenarioStore';

const SCENARIO_DEPENDENT_KEYS = [['snapshot'], ['analysis'], ['robustness']];

function useInvalidateScenarioDependents() {
  const queryClient = useQueryClient();
  return () =>
    SCENARIO_DEPENDENT_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
}

export function useLoadScenario() {
  const setScenario = useScenarioStore((s) => s.setScenario);
  const invalidate = useInvalidateScenarioDependents();
  return useMutation({
    mutationFn: (scenario: Scenario) => loadScenario(scenario).then(() => scenario),
    onSuccess: (scenario) => {
      setScenario(scenario);
      invalidate();
    },
  });
}

export function useUpdateConfig() {
  const setScenario = useScenarioStore((s) => s.setScenario);
  const invalidate = useInvalidateScenarioDependents();
  return useMutation({
    mutationFn: (update: ConfigUpdate) => updateConfig(update),
    onSuccess: ({ scenario }) => {
      setScenario(scenario);
      invalidate();
    },
  });
}

export function useSnapshot(t_s: number, enabled: boolean) {
  return useQuery({
    queryKey: ['snapshot', t_s],
    queryFn: () => getSnapshot(t_s),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useAnalysis(enabled: boolean) {
  return useQuery({
    queryKey: ['analysis'],
    queryFn: getAnalysis,
    enabled,
  });
}

export function useRobustness(branch: number, enabled: boolean) {
  return useQuery({
    queryKey: ['robustness', branch],
    queryFn: () => getRobustness(branch),
    enabled,
  });
}

export function useAutoTune() {
  return useMutation({
    mutationFn: ({ randomSamples, seed }: { randomSamples: number; seed: number }) =>
      getAutoTune(randomSamples, seed),
  });
}

export function useSaveVariant() {
  const addSavedVariant = useScenarioStore((s) => s.addSavedVariant);
  return useMutation({
    mutationFn: (name: string) => saveVariant(name),
    onSuccess: (_, name) => addSavedVariant(name),
  });
}

export function useCompareVariants() {
  return useMutation({
    mutationFn: ({ name1, name2 }: { name1: string; name2: string }) =>
      compareVariants(name1, name2),
  });
}
