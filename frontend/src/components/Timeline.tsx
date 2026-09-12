// src/components/Timeline.tsx
//
// Слайдер по t_s с шагом environment.step_s (п.7 ТЗ) + воспроизведение с
// регулируемой скоростью (во сколько раз модельное время идёт быстрее
// реального — не жёстко "по одному шагу", а с выбором множителя).

import { useEffect, useRef } from 'react';
import { PLAYBACK_SPEEDS, useTimelineStore } from '../stores/timelineStore';
import { HudButton } from './HudButton';

interface TimelineProps {
  horizonS: number;
  stepS: number;
}

const TICK_MS = 250;

function formatTime(t_s: number): string {
  const h = Math.floor(t_s / 3600);
  const m = Math.floor((t_s % 3600) / 60);
  const s = Math.floor(t_s % 60);
  return `${h}ч ${String(m).padStart(2, '0')}м ${String(s).padStart(2, '0')}с`;
}

export function Timeline({ horizonS, stepS }: TimelineProps) {
  const t_s = useTimelineStore((s) => s.t_s);
  const playing = useTimelineStore((s) => s.playing);
  const speed = useTimelineStore((s) => s.speed);
  const setTs = useTimelineStore((s) => s.setTs);
  const toggle = useTimelineStore((s) => s.toggle);
  const pause = useTimelineStore((s) => s.pause);
  const setSpeed = useTimelineStore((s) => s.setSpeed);

  // Дробный аккумулятор шагов — так speed=0.5 реально идёт вдвое медленнее
  // 1x (шаг раз в два тика), а не округляется до того же самого шага.
  const stepsAccumulator = useRef(0);

  useEffect(() => {
    if (!playing) return;
    stepsAccumulator.current = 0;
    const id = setInterval(() => {
      stepsAccumulator.current += speed;
      const stepsToAdvance = Math.floor(stepsAccumulator.current);
      if (stepsToAdvance < 1) return;
      stepsAccumulator.current -= stepsToAdvance;
      useTimelineStore.setState((state) => {
        const next = state.t_s + stepsToAdvance * stepS;
        return next >= horizonS ? { t_s: horizonS - stepS, playing: false } : { t_s: next };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, horizonS, stepS, speed]);

  useEffect(() => {
    if (t_s >= horizonS) pause();
  }, [t_s, horizonS, pause]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t-2 border-sky-500/40 bg-slate-900/40 p-3 backdrop-blur-sm">
      <HudButton onClick={toggle} className="w-20">
        {playing ? 'Пауза' : 'Play'}
      </HudButton>

      <div className="flex items-center gap-0.5 border border-slate-700/60 bg-slate-950/60 p-0.5 font-mono">
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`px-2 py-1 text-xs transition ${
              speed === s ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, horizonS - stepS)}
        step={stepS}
        value={t_s}
        onChange={(e) => setTs(Number(e.target.value))}
        className="min-w-[120px] flex-1 accent-sky-400"
      />
      <span className="w-32 shrink-0 text-right font-mono text-sm text-sky-300">
        {formatTime(t_s)}
      </span>
    </div>
  );
}
