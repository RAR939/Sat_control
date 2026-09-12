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
import { ObjectDetailsPanel, type ObjectSelection } from '../components/ObjectDetailsPanel';
import { pluralize } from '../utils/pluralize';

/** Скачивает объект как .json-файл — чисто на клиенте, без обращения к
 *  бэкенду (нужно для результата автоподбора, у которого нет отдельного
 *  файлового эндпоинта на бэке). */
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SimulationPage() {
  const scenario = useScenarioStore((s) => s.scenario);
  const t_s = useTimelineStore((s) => s.t_s);
  const selectedClientId = useUiStore((s) => s.selectedClientId);
  const setSelectedClientId = useUiStore((s) => s.setSelectedClientId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const [robustnessEnabled, setRobustnessEnabled] = useState(false);
  const [objectSelection, setObjectSelection] = useState<ObjectSelection | null>(null);

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

  const bestConfig = autoTuneMutation.data?.best_configuration;
  const planeDiffs = bestConfig
    ? scenario.design.planes.map((p) => {
        const proposed = bestConfig.planes[p.id];
        return {
          id: p.id,
          raanBefore: p.raan_deg,
          raanAfter: proposed?.raan_deg ?? p.raan_deg,
          phaseBefore: p.phase_deg,
          phaseAfter: proposed?.phase_deg ?? p.phase_deg,
        };
      })
    : [];
  const clientDiffs = bestConfig
    ? Object.entries(bestConfig.per_client_availability_pct).map(([id, after]) => ({
        id,
        before: analysisQuery.data?.analysis[id]?.availability_pct ?? null,
        after,
      }))
    : [];
  // Критерий поиска — минимум по клиентам, а не среднее: узнаём, кто именно
  // был "слабым звеном" в текущей конфигурации, чтобы объяснить, зачем
  // вообще что-то менять и на кого это повлияет сильнее всего.
  const worstClientBefore = analysisQuery.data
    ? Object.entries(analysisQuery.data.analysis).reduce<{ id: string; value: number } | null>(
        (worst, [id, a]) =>
          worst === null || a.availability_pct < worst.value
            ? { id, value: a.availability_pct }
            : worst,
        null,
      )
    : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <Timeline horizonS={scenario.environment.horizon_s} stepS={scenario.environment.step_s} />
        <p className="mt-1 text-xs text-slate-500">
          Ползунок и кнопка Play управляют модельным временем — для каждого момента заново
          пересчитываются положение спутников, доступные связи и рабочий маршрут до шлюза.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <label className="tracking-[0.1em] text-slate-500 uppercase">Клиентский терминал</label>
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
            {isConnected
              ? `на связи · ${selectedRoute!.length - 1} ${pluralize(selectedRoute!.length - 1, ['переход', 'перехода', 'переходов'])}`
              : 'нет связи'}
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

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="min-w-0 md:flex-1">
          <Globe3D
            snapshot={snapshotQuery.data?.snapshot}
            groundSites={scenario.ground_sites}
            routes={snapshotQuery.data?.routes}
            selectedClientId={selectedClientId}
            onSelectSatellite={(id) => setObjectSelection({ type: 'satellite', id })}
            onSelectGroundSite={(id) => {
              setObjectSelection({ type: 'ground', id });
              // Клик по клиентскому терминалу на глобусе сразу выбирает его
              // для подсветки маршрута — так же, как выбор из списка ниже.
              if (scenario.ground_sites.find((g) => g.id === id)?.role === 'client') {
                setSelectedClientId(id);
              }
            }}
            onClearSelection={() => setObjectSelection(null)}
          />
        </div>
        {objectSelection && (
          <ObjectDetailsPanel
            selection={objectSelection}
            scenario={scenario}
            snapshot={snapshotQuery.data?.snapshot}
            routes={snapshotQuery.data?.routes}
            onClose={() => setObjectSelection(null)}
          />
        )}
      </div>
      {snapshotQuery.isError && (
        <p className="text-sm text-rose-400">{(snapshotQuery.error as Error).message}</p>
      )}

      <section>
        <h2 className="mb-1 font-mono text-sm font-semibold text-slate-300">Доступность связи</h2>
        <p className="mb-2 text-xs text-slate-500">
          Столбцы — доля времени за весь горизонт расчёта, когда у клиента был рабочий маршрут до
          шлюза; жёлтая линия — целевой порог доступности. Нижний график — связность выбранного
          клиента по времени, провалы — разрывы связи.
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
          <h2 className="font-mono text-sm font-semibold text-slate-300">Анализ устойчивости</h2>
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
                <th className="pb-1 font-normal">Полный обрыв связи</th>
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
          <h2 className="font-mono text-sm font-semibold text-slate-300">
            Автоподбор конфигурации
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
          клиента, и объясняет, за счёт чего конкретно найденная конфигурация лучше текущей.
        </p>
        {bestConfig && (
          <div className="font-mono text-sm text-slate-300">
            <p className="mb-3">
              Минимальная (по клиентам) доступность вырастет с{' '}
              <span className="text-slate-100">
                {bestConfig.baseline_min_availability_pct.toFixed(1)}%
              </span>{' '}
              до{' '}
              <span className="text-emerald-400">
                {bestConfig.min_availability_pct.toFixed(1)}%
              </span>{' '}
              ({bestConfig.improvement_over_baseline_pct >= 0 ? '+' : ''}
              {bestConfig.improvement_over_baseline_pct.toFixed(1)} п.п., проверено на{' '}
              {bestConfig.evaluations_count} вариантах).
            </p>

            <p className="mb-3 border-l-2 border-sky-500/40 pl-3 text-xs text-slate-400">
              <span className="text-slate-300">Почему именно эта конфигурация:</span> критерий
              поиска — минимальная доступность среди клиентов, а не средняя (иначе можно улучшить
              одного клиента за счёт другого).
              {worstClientBefore && (
                <>
                  {' '}
                  Сейчас самое узкое место —{' '}
                  <span className="text-slate-200">{worstClientBefore.id}</span> (
                  {worstClientBefore.value.toFixed(1)}%); найденная конфигурация поднимает именно
                  его до{' '}
                  <span className="text-emerald-400">
                    {(
                      bestConfig.per_client_availability_pct[worstClientBefore.id] ??
                      bestConfig.min_availability_pct
                    ).toFixed(1)}
                    %
                  </span>
                  .
                </>
              )}{' '}
              Способ поиска: {bestConfig.evaluations_count} случайных комбинаций RAAN/фазы
              плоскостей и последующая локальная донастройка (покоординатный подъём) вокруг лучших
              найденных — полный перебор всех углов физически невозможен (континуум значений на 3
              плоскости).
            </p>

            <p className="mb-1 text-xs tracking-[0.1em] text-slate-500 uppercase">
              Что изменится по клиентам
            </p>
            <table className="mb-3 w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-1 font-normal">Клиент</th>
                  <th className="pb-1 font-normal">Сейчас</th>
                  <th className="pb-1 font-normal">После</th>
                  <th className="pb-1 font-normal">Δ</th>
                </tr>
              </thead>
              <tbody>
                {clientDiffs.map((c) => (
                  <tr key={c.id} className="border-t border-slate-800">
                    <td className="py-1">{c.id}</td>
                    <td className="py-1">{c.before !== null ? `${c.before.toFixed(1)}%` : '—'}</td>
                    <td className="py-1">{c.after.toFixed(1)}%</td>
                    <td
                      className={`py-1 ${c.before !== null && c.after - c.before >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                    >
                      {c.before !== null
                        ? `${c.after - c.before >= 0 ? '+' : ''}${(c.after - c.before).toFixed(1)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mb-1 text-xs tracking-[0.1em] text-slate-500 uppercase">
              Что изменится в плоскостях
            </p>
            <table className="mb-3 w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-1 font-normal">Плоскость</th>
                  <th className="pb-1 font-normal">RAAN</th>
                  <th className="pb-1 font-normal">Фаза</th>
                </tr>
              </thead>
              <tbody>
                {planeDiffs.map((p) => (
                  <tr key={p.id} className="border-t border-slate-800">
                    <td className="py-1">{p.id}</td>
                    <td className="py-1">
                      {p.raanBefore.toFixed(1)}° → {p.raanAfter.toFixed(1)}°
                    </td>
                    <td className="py-1">
                      {p.phaseBefore.toFixed(1)}° → {p.phaseAfter.toFixed(1)}°
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-2">
              <HudButton
                onClick={() =>
                  updateConfigMutation.mutate({
                    planes_update: Object.entries(bestConfig.planes).map(([id, p]) => ({
                      id,
                      raan_deg: p.raan_deg,
                      phase_deg: p.phase_deg,
                    })),
                  })
                }
              >
                Применить конфигурацию
              </HudButton>
              <HudButton
                variant="ghost"
                onClick={() =>
                  downloadJson(
                    {
                      schema_version: 'cosmo-A-autotune-1.0',
                      scenario_id: scenario.meta.id,
                      best_configuration: bestConfig,
                    },
                    `autotune_${scenario.meta.id}.json`,
                  )
                }
              >
                Скачать JSON
              </HudButton>
              {updateConfigMutation.isSuccess && (
                <span className="self-center text-emerald-400">Применено ✓</span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
