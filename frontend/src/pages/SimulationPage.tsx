// src/pages/SimulationPage.tsx
//
// Экран "Симуляция/визуализация" (п.7 ТЗ): таймлайн + 3D-глобус + графики
// availability/outage + доп. задачи 5/6 (устойчивость, автоподбор) + экспорт.

import { useState } from 'react';
import { useScenarioStore } from '../stores/scenarioStore';
import { useTimelineStore } from '../stores/timelineStore';
import { useUiStore } from '../stores/uiStore';
import {
  useAnalysis,
  useAutoTune,
  useRobustness,
  useSnapshot,
  useUpdateConfig,
} from '../api/hooks';
import { exportAnalysisUrl } from '../api/client';
import { Timeline } from '../components/Timeline';
import { Globe3D } from '../components/Globe3D';
import { AvailabilityChart } from '../components/AvailabilityChart';
import { HudButton } from '../components/HudButton';

export function SimulationPage() {
  const scenario = useScenarioStore((s) => s.scenario);
  const t_s = useTimelineStore((s) => s.t_s);
  const selectedClientId = useUiStore((s) => s.selectedClientId);
  const setSelectedClientId = useUiStore((s) => s.setSelectedClientId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const [robustnessEnabled, setRobustnessEnabled] = useState(false);

  const snapshotQuery = useSnapshot(t_s, !!scenario);
  const analysisQuery = useAnalysis(!!scenario);
  const robustnessQuery = useRobustness(1, robustnessEnabled);
  const autoTuneMutation = useAutoTune();
  const updateConfigMutation = useUpdateConfig();

  if (!scenario) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 border-l-2 border-slate-700 bg-slate-900/40 p-8 text-center backdrop-blur-sm">
        <p className="text-slate-300">
          Сначала нужно загрузить сценарий — без него не с чем считать сеть.
        </p>
        <HudButton onClick={() => setActiveTab('editor')}>← Перейти в редактор</HudButton>
      </div>
    );
  }

  const clients = scenario.ground_sites.filter((g) => g.role === 'client');
  const exportUrl = exportAnalysisUrl();
  const selectedRoute = selectedClientId ? snapshotQuery.data?.routes[selectedClientId] : undefined;
  const isConnected = selectedRoute !== undefined && selectedRoute.length > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <Timeline horizonS={scenario.environment.horizon_s} stepS={scenario.environment.step_s} />
        <p className="mt-1 text-xs text-slate-500">
          Двигай ползунок или жми Play — на каждый момент времени пересчитывается положение
          спутников, связи и рабочий маршрут до шлюза.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <label className="tracking-[0.1em] text-slate-500 uppercase">Клиентский терминал:</label>
        <select
          value={selectedClientId ?? ''}
          onChange={(e) => setSelectedClientId(e.target.value || null)}
          className="border border-slate-700 bg-slate-800 px-2 py-1.5 text-slate-200"
        >
          <option value="">— выбрать —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.id})
            </option>
          ))}
        </select>
        {selectedClientId && (
          <span
            className={`border px-2 py-1 tracking-[0.05em] uppercase ${
              isConnected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
            }`}
          >
            {isConnected ? `на связи · ${selectedRoute!.length - 1} хоп(ов)` : 'нет связи'}
          </span>
        )}
        {exportUrl && (
          <a
            href={exportUrl}
            className="ml-auto border border-slate-700 px-3 py-1.5 tracking-[0.1em] text-slate-400 uppercase transition hover:border-slate-500 hover:text-slate-200"
          >
            Экспорт JSON
          </a>
        )}
      </div>

      <Globe3D
        snapshot={snapshotQuery.data?.snapshot}
        groundSites={scenario.ground_sites}
        routes={snapshotQuery.data?.routes}
        selectedClientId={selectedClientId}
      />
      {snapshotQuery.isError && (
        <p className="text-sm text-rose-400">{(snapshotQuery.error as Error).message}</p>
      )}

      <section>
        <h2 className="mb-1 flex items-baseline gap-2 font-mono text-sm font-semibold text-slate-300">
          <span className="text-sky-500">03</span> Доступность связи
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          Столбцы — доля времени за весь горизонт расчёта, когда у клиента был рабочий маршрут до
          шлюза; жёлтая линия — целевой порог (target_availability). Нижний график — связность
          выбранного клиента по времени, провалы — разрывы связи.
        </p>
        {analysisQuery.data && (
          <AvailabilityChart
            analysis={analysisQuery.data}
            targetAvailability={scenario.environment.target_availability}
            selectedClientId={selectedClientId}
          />
        )}
        {analysisQuery.isLoading && (
          <p className="text-sm text-slate-400">Считаем полный анализ...</p>
        )}
        {analysisQuery.isError && (
          <p className="text-sm text-rose-400">{(analysisQuery.error as Error).message}</p>
        )}
      </section>

      <section className="border-l-2 border-slate-700 bg-slate-900/40 p-4 backdrop-blur-sm">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-baseline gap-2 font-mono text-sm font-semibold text-slate-300">
            <span className="text-sky-500">04</span> Доп. п.5 — Анализ устойчивости
          </h2>
          <HudButton
            variant="ghost"
            onClick={() => setRobustnessEnabled(true)}
            disabled={robustnessQuery.isFetching}
          >
            {robustnessQuery.isFetching ? 'Считаем…' : 'Запустить'}
          </HudButton>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          По очереди «отключаем» каждый спутник на весь горизонт и смотрим, насколько падает худшая
          (по клиентам) доступность — так находим самые критичные аппараты в группировке.
        </p>
        {robustnessQuery.data && (
          <table className="w-full text-left font-mono text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-1 font-normal">Спутник</th>
                <th className="pb-1 font-normal">Падение мин. доступности</th>
                <th className="pb-1 font-normal">Полный обрыв?</th>
              </tr>
            </thead>
            <tbody>
              {robustnessQuery.data.robustness_rating.slice(0, 10).map((r) => (
                <tr key={r.satellite_ids.join(',')} className="border-t border-slate-800">
                  <td className="py-1">{r.satellite_ids.join(', ')}</td>
                  <td className="py-1">{r.worst_case_availability_drop_pct.toFixed(1)}%</td>
                  <td className="py-1">{r.causes_full_outage ? 'да' : 'нет'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border-l-2 border-slate-700 bg-slate-900/40 p-4 backdrop-blur-sm">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-baseline gap-2 font-mono text-sm font-semibold text-slate-300">
            <span className="text-sky-500">05</span> Доп. п.6 — Автоподбор конфигурации
          </h2>
          <HudButton
            variant="ghost"
            onClick={() => autoTuneMutation.mutate({ randomSamples: 8, seed: 42 })}
            disabled={autoTuneMutation.isPending}
          >
            {autoTuneMutation.isPending ? 'Считаем…' : 'Запустить'}
          </HudButton>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Подбирает RAAN/фазу орбитальных плоскостей так, чтобы максимизировать доступность худшего
          клиента.
        </p>
        {autoTuneMutation.data && (
          <div className="font-mono text-sm text-slate-300">
            <p>
              Мин. доступность:{' '}
              {autoTuneMutation.data.best_configuration.min_availability_pct.toFixed(1)}% (было{' '}
              {autoTuneMutation.data.best_configuration.baseline_min_availability_pct.toFixed(1)}%,
              улучшение{' '}
              {autoTuneMutation.data.best_configuration.improvement_over_baseline_pct.toFixed(1)}{' '}
              п.п.)
            </p>
            <HudButton
              className="mt-2"
              onClick={() =>
                updateConfigMutation.mutate({
                  planes_update: Object.entries(
                    autoTuneMutation.data!.best_configuration.planes,
                  ).map(([id, p]) => ({
                    id,
                    raan_deg: p.raan_deg,
                    phase_deg: p.phase_deg,
                  })),
                })
              }
            >
              Применить найденную конфигурацию
            </HudButton>
          </div>
        )}
      </section>
    </div>
  );
}
