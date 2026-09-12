// src/stores/scenarioStore.ts
//
// Активный сценарий на фронте — зеркало current_scenario на бэкенде (см.
// CLAUDE.md: это ОДНО глобальное состояние, а не REST-ресурс по id).
// Обновляется после каждого успешного /api/load или /api/update-config,
// чтобы формы редактора и карта всегда показывали то же, что бэкенд
// фактически использует для расчётов.

import { create } from 'zustand';
import type { Scenario } from '../types/scenario';

interface ScenarioStore {
  scenario: Scenario | null;
  savedVariantNames: string[];
  setScenario: (scenario: Scenario) => void;
  addSavedVariant: (name: string) => void;
}

export const useScenarioStore = create<ScenarioStore>((set) => ({
  scenario: null,
  savedVariantNames: [],
  setScenario: (scenario) => set({ scenario }),
  addSavedVariant: (name) =>
    set((state) => ({
      savedVariantNames: state.savedVariantNames.includes(name)
        ? state.savedVariantNames
        : [...state.savedVariantNames, name],
    })),
}));
