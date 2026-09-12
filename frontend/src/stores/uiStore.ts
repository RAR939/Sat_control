// src/stores/uiStore.ts
//
// Состояние навигации/UI, не относящееся ни к сценарию, ни к таймлайну:
// активный экран (п.7 ТЗ — табы "Сценарный редактор" / "Симуляция") и
// выбранный клиент для графиков/подсветки на карте.

import { create } from 'zustand';

export type AppTab = 'editor' | 'simulation';

interface UiStore {
  activeTab: AppTab;
  selectedClientId: string | null;
  setActiveTab: (tab: AppTab) => void;
  setSelectedClientId: (id: string | null) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  activeTab: 'editor',
  selectedClientId: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setSelectedClientId: (selectedClientId) => set({ selectedClientId }),
}));
