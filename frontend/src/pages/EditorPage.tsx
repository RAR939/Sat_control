// src/pages/EditorPage.tsx
//
// Сценарный редактор (п.7 ТЗ). Полную схему Scenario руками не собираем —
// сценарии загружаются целиком (демо-файл из public/sample-scenarios/ или
// свой JSON), а редактируются только поля, которые реально принимает
// POST /api/update-config: launch_stage, isl_range_km, planes (raan/phase),
// failures. Это осознанное ограничение: бэкенд не даёт REST по id, а
// пересобирать design.satellites/ground_sites через форму — не нужно для
// MVP и не поддержано update-config всё равно.

import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { useScenarioStore } from '../stores/scenarioStore';
import { useUiStore } from '../stores/uiStore';
import { useLoadScenario, useSaveVariant, useUpdateConfig } from '../api/hooks';
import { fetchSampleScenario } from '../api/client';
import { SAMPLE_SCENARIOS } from '../api/mock/fixtures';
import type { Scenario } from '../types/scenario';
import { HudButton } from '../components/HudButton';

const configFormSchema = z.object({
  launch_stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  isl_range_km: z.number().gt(0).lte(10000),
  planes: z.array(
    z.object({
      id: z.string(),
      raan_deg: z.number().min(0).lt(360),
      phase_deg: z.number().min(0).lt(360),
    }),
  ),
  failures: z.array(
    z.object({
      satellite_id: z.string().min(1, 'Выберите спутник'),
      start_s: z.number().min(0),
      end_s: z.number().min(0),
    }),
  ),
});

type ConfigFormValues = z.infer<typeof configFormSchema>;

function scenarioToFormValues(scenario: Scenario): ConfigFormValues {
  return {
    launch_stage: scenario.design.launch_stage,
    isl_range_km: scenario.environment.isl_range_km,
    planes: scenario.design.planes.map((p) => ({
      id: p.id,
      raan_deg: p.raan_deg,
      phase_deg: p.phase_deg,
    })),
    failures: scenario.failures.map((f) => ({ ...f })),
  };
}

export function EditorPage() {
  const scenario = useScenarioStore((s) => s.scenario);
  const savedVariantNames = useScenarioStore((s) => s.savedVariantNames);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const loadScenarioMutation = useLoadScenario();
  const updateConfigMutation = useUpdateConfig();
  const saveVariantMutation = useSaveVariant();

  const [sampleFile, setSampleFile] = useState(SAMPLE_SCENARIOS[0].file);
  const [variantName, setVariantName] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ConfigFormValues>({
    defaultValues: { launch_stage: 3, isl_range_km: 3000, planes: [], failures: [] },
  });
  const failuresArray = useFieldArray({ control, name: 'failures' });

  useEffect(() => {
    if (scenario) reset(scenarioToFormValues(scenario));
  }, [scenario, reset]);

  const onLoadSample = async () => {
    const data = await fetchSampleScenario(sampleFile);
    loadScenarioMutation.mutate(data);
  };

  const onUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const rawText = await file.text();
    // Файлы, сохранённые из редакторов на Windows, часто начинаются с
    // UTF-8 BOM (U+FEFF) — JSON.parse падает на нём с "Unexpected token",
    // хотя сам JSON внутри валиден. Срезаем BOM перед парсингом.
    const text = rawText.replace(/^\uFEFF/, '').trim();
    try {
      const data = JSON.parse(text) as Scenario;
      setUploadError(null);
      loadScenarioMutation.mutate(data);
    } catch (err) {
      setUploadError(
        `Не удалось прочитать JSON сценария: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    e.target.value = '';
  };

  const onSubmit = handleSubmit((values) => {
    const parsed = configFormSchema.safeParse(values);
    if (!parsed.success) {
      setFormError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setFormError(null);
    updateConfigMutation.mutate({
      launch_stage: parsed.data.launch_stage,
      isl_range_km: parsed.data.isl_range_km,
      planes_update: parsed.data.planes,
      failures_update: parsed.data.failures,
    });
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-slate-400">
        Сначала загрузите сценарий (спутники, орбиты, наземные пункты) — это станет активной
        конфигурацией на бэкенде. Дальше можно поменять очередь запуска, дальность связи между
        спутниками и добавить отказы, применить изменения и перейти к 3D-визуализации.
      </p>
      <section className="border-l-2 border-sky-500/50 bg-slate-900/40 p-4 backdrop-blur-sm">
        <h2 className="mb-3 font-mono text-sm font-semibold text-slate-300">Загрузить сценарий</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sampleFile}
            onChange={(e) => setSampleFile(e.target.value)}
            className="border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-sm text-slate-200"
          >
            {SAMPLE_SCENARIOS.map((s) => (
              <option key={s.id} value={s.file}>
                {s.title}
              </option>
            ))}
          </select>
          <HudButton onClick={onLoadSample} disabled={loadScenarioMutation.isPending}>
            Загрузить пример
          </HudButton>
          <label className="cursor-pointer border border-slate-700 px-3 py-2 font-mono text-xs tracking-[0.1em] text-slate-400 uppercase transition hover:border-slate-500 hover:text-slate-200">
            Загрузить свой JSON
            <input
              type="file"
              accept="application/json"
              onChange={onUploadFile}
              className="hidden"
            />
          </label>
        </div>
        {loadScenarioMutation.isError && (
          <p className="mt-2 text-sm text-rose-400">
            {(loadScenarioMutation.error as Error).message}
          </p>
        )}
        {uploadError && <p className="mt-2 text-sm text-rose-400">{uploadError}</p>}
      </section>

      {scenario && (
        <>
          <section className="flex flex-wrap gap-x-6 gap-y-1 border-l-2 border-slate-700 bg-slate-900/40 p-4 font-mono text-xs text-slate-400 backdrop-blur-sm">
            <span>
              СЦЕНАРИЙ <span className="text-slate-200">{scenario.meta.title}</span>
            </span>
            <span>
              СПУТНИКОВ <span className="text-slate-200">{scenario.design.satellites.length}</span>
            </span>
            <span>
              ПЛОСКОСТЕЙ <span className="text-slate-200">{scenario.design.planes.length}</span>
            </span>
            <span>
              НАЗЕМНЫХ ПУНКТОВ{' '}
              <span className="text-slate-200">{scenario.ground_sites.length}</span>
            </span>
          </section>

          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-4 border-l-2 border-sky-500/50 bg-slate-900/40 p-4 backdrop-blur-sm"
          >
            <div>
              <h2 className="font-mono text-sm font-semibold text-slate-300">
                Параметры конфигурации
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Изменения здесь сразу обновляют активный сценарий: расчёты на вкладке «Симуляция»
                (глобус, графики, устойчивость) используют новые значения.
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex flex-col gap-1 text-sm">
                Очередь запуска
                <select
                  {...register('launch_stage', { valueAsNumber: true })}
                  className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Дальность ISL, км
                <input
                  type="number"
                  step="any"
                  {...register('isl_range_km', { valueAsNumber: true })}
                  className="w-32 rounded border border-slate-700 bg-slate-800 px-2 py-1.5"
                />
              </label>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Орбитальные плоскости
              </h3>
              <div className="flex flex-col gap-2">
                {scenario.design.planes.map((plane, index) => (
                  <div key={plane.id} className="flex items-center gap-3 text-sm">
                    <span className="w-10 text-slate-400">{plane.id}</span>
                    <label className="flex items-center gap-1">
                      RAAN, °
                      <input
                        type="number"
                        step="any"
                        {...register(`planes.${index}.raan_deg`, { valueAsNumber: true })}
                        className="w-24 rounded border border-slate-700 bg-slate-800 px-2 py-1"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      Фаза, °
                      <input
                        type="number"
                        step="any"
                        {...register(`planes.${index}.phase_deg`, { valueAsNumber: true })}
                        className="w-24 rounded border border-slate-700 bg-slate-800 px-2 py-1"
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Отказы спутников
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    failuresArray.append({
                      satellite_id: scenario.design.satellites[0]?.id ?? '',
                      start_s: 0,
                      end_s: scenario.environment.horizon_s,
                    })
                  }
                  className="text-xs text-sky-400 hover:text-sky-300"
                >
                  + Добавить отказ
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {failuresArray.fields.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2 text-sm">
                    <select
                      {...register(`failures.${index}.satellite_id`)}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1"
                    >
                      {scenario.design.satellites.map((sat) => (
                        <option key={sat.id} value={sat.id}>
                          {sat.id}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      {...register(`failures.${index}.start_s`, { valueAsNumber: true })}
                      className="w-28 rounded border border-slate-700 bg-slate-800 px-2 py-1"
                      placeholder="начало, с"
                    />
                    <input
                      type="number"
                      {...register(`failures.${index}.end_s`, { valueAsNumber: true })}
                      className="w-28 rounded border border-slate-700 bg-slate-800 px-2 py-1"
                      placeholder="конец, с"
                    />
                    <button
                      type="button"
                      onClick={() => failuresArray.remove(index)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {errors.failures && <p className="text-sm text-rose-400">Проверьте поля отказов</p>}
              </div>
            </div>

            {formError && <p className="text-sm text-rose-400">{formError}</p>}
            {updateConfigMutation.isError && (
              <p className="text-sm text-rose-400">
                {(updateConfigMutation.error as Error).message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <HudButton type="submit" disabled={updateConfigMutation.isPending}>
                Применить конфигурацию
              </HudButton>
              {updateConfigMutation.isSuccess && (
                <span className="font-mono text-xs text-emerald-400">Обновлено ✓</span>
              )}

              <span className="mx-1 h-5 w-px bg-slate-700" aria-hidden="true" />

              <input
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="имя варианта"
                className="w-36 border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600"
              />
              <HudButton
                variant="ghost"
                disabled={!variantName || saveVariantMutation.isPending}
                onClick={() => {
                  saveVariantMutation.mutate(variantName);
                  setVariantName('');
                }}
              >
                Сохранить конфигурацию
              </HudButton>

              <button
                type="button"
                onClick={() => setActiveTab('simulation')}
                className="ml-auto font-mono text-xs tracking-[0.1em] text-slate-400 uppercase underline decoration-slate-600 underline-offset-4 transition hover:text-sky-300 hover:decoration-sky-400"
              >
                Перейти к симуляции →
              </button>
            </div>
            {savedVariantNames.length > 0 && (
              <p className="text-xs text-slate-500">
                Сохранённые варианты: {savedVariantNames.join(', ')}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}
