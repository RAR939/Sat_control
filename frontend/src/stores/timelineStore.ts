// src/stores/timelineStore.ts
//
// Текущая позиция на таймлайне (t_s) и состояние воспроизведения — п.7 ТЗ
// (слайдер по t_s с шагом environment.step_s). Границы (0..horizon_s) и шаг
// задаёт активный сценарий, поэтому здесь хранится только "сырой" t_s —
// компоненты сами клэмпят его под текущий сценарий.

import { create } from 'zustand';

/** Множитель скорости воспроизведения — во сколько раз быстрее модельного
 *  времени идёт симуляция относительно реального. */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 5, 10, 20] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

interface TimelineStore {
  t_s: number;
  playing: boolean;
  speed: PlaybackSpeed;
  setTs: (t_s: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
}

export const useTimelineStore = create<TimelineStore>((set) => ({
  t_s: 0,
  playing: false,
  speed: 1,
  setTs: (t_s) => set({ t_s }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set((state) => ({ playing: !state.playing })),
  setSpeed: (speed) => set({ speed }),
}));
