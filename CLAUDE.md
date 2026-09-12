# CosmoSats Frontend — контекст проекта для Claude Code

## ⚠️ ГРАНИЦА ОТВЕТСТВЕННОСТИ
**Мы работаем ТОЛЬКО с фронтендом (папка `frontend/`).**
Бэкенд (`backend/`, FastAPI, Python) делают коллеги по команде — **не трогать,
не редактировать, не рефакторить их код**, даже если он кажется неидеальным
или неполным. Если для работы фронтенда чего-то не хватает на бэкенде —
это обсуждается с командой, а не чинится самостоятельно правкой их файлов.
Любые правки вне `frontend/` — под явным запретом без отдельного запроса
пользователя.

## Задача
КосмоХакатон 2026 «Проектирование устойчивой спутниковой группировки».
Веб-сервис для проектирования/анализа группировки связи: 48 спутников,
орбита 550 км, 3 плоскости по 16 аппаратов, запуск в 3 очереди (launch_stage).
Считает покрытие северных наземных пунктов, маршрутизацию до шлюза через
сеть спутников, обрабатывает отказы, сравнивает конфигурации.
Целевая доступность (target_availability) — 90%.

Репозиторий: https://github.com/RAR939/Sat_control

Дедлайн крайне сжатый — приоритет: рабочий MVP по п.7 ТЗ (фронтенд), не
идеальная архитектура.

## Стек и уже принятые решения
- React + TypeScript, сборка на Vite.
- ESLint (flat config, `eslint.config.js`) + Prettier — раздельная ответственность
  (ESLint = баги/практики, Prettier = форматирование), eslint-config-prettier
  гасит конфликтующие правила. ESLint держим на 9.x (не 10.x) — плагины
  eslint-plugin-react/react-hooks пока официально не поддерживают ESLint 10
  (открытые issues в их репозиториях на сентябрь 2026).
- Tailwind CSS 4 через `@tailwindcss/vite` плагин (не PostCSS-конфиг).
- TanStack Query поверх api/client.ts — ещё предстоит подключить.
- Zustand для state management — ещё предстоит подключить.
- **2D-карта (equirectangular) — в приоритете, НЕ 3D-глобус.** Ранее
  предлагался react-globe.gl/3D — это устарело, ориентироваться на 2D-рендер
  (например canvas/SVG с проекцией lat/lon).
- Весь код — с подробными комментариями (нужна документация проекта в конце).
- Не переименовывать поля бэкенда "покрасивее" — фронт обязан слать точные
  ключи из схемы cosmo-A-1.0, иначе Pydantic на бэке отклонит запрос.

## Реальный контракт бэкенда (проверено через реальные файлы в репозитории)

### Важно: НЕ отдельные сценарии по id
Бэкенд хранит ОДИН активный сценарий в памяти (`current_scenario`), плюс
именованные сохранённые варианты (`saved_variants`) для сравнения. Это не
REST-ресурсы с CRUD по id, а глобальное состояние + операции над ним.

### Эндпоинты (backend/main.py)
| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/load` | Загрузить сценарий как активный (`{scenario_data: Scenario}`) |
| POST | `/api/update-config` | Частично изменить активный сценарий (launch_stage, isl_range_km, planes_update, failures_update) |
| GET | `/api/snapshot/{t_s}` | Состояние сети на момент времени t_s |
| POST | `/api/save-variant/{name}` | Сохранить активный сценарий как именованный вариант |
| GET | `/api/compare/{name1}/{name2}` | Сравнить два сохранённых варианта |
| GET | `/api/analysis` | Полный анализ (`run_full_simulation()`) |
| GET | `/api/robustness` | Анализ устойчивости (п.5 ТЗ, доп.) |
| GET | `/api/auto-tune` | Автоподбор конфигурации (п.6 ТЗ, доп.) |

Swagger UI: `http://localhost:8000/docs` — сверять точные схемы там, когда
бэкенд поднят локально.

### Схема сценария (schema_version "cosmo-A-1.0")
Проверено на реальных файлах `data/01_full_constellation.json` и
`data/03_satellite_outages.json` из репозитория:

```json
{
  "schema_version": "cosmo-A-1.0",
  "meta": { "id": "...", "title": "..." },
  "environment": {
    "altitude_km": 550.0, "inclination_deg": 87.0, "earth_angle0_deg": 12.0,
    "horizon_s": 86400, "step_s": 120, "min_elevation_deg": 10.0,
    "isl_range_km": 3000.0, "target_availability": 0.9
  },
  "design": {
    "launch_stage": 3,
    "planes": [{ "id": "P1", "raan_deg": 0.0, "phase_deg": 0.0 }],
    "satellites": [{ "id": "S01", "plane_id": "P1", "slot_deg": 0.0, "launch_batch": 1 }]
  },
  "ground_sites": [
    { "id": "G_MUR", "name": "Murmansk gateway", "role": "gateway", "lat_deg": 68.97, "lon_deg": 33.07 }
  ],
  "failures": [{ "satellite_id": "S31", "start_s": 21600, "end_s": 86400 }],
  "gateway_outages": []
}
```

### Snapshot (`GET /api/snapshot/{t_s}`, backend/geometry.py)
Позиции спутников — ДЕКАРТОВЫ координаты (`x_km, y_km, z_km`), НЕ lat/lon!
Для 2D-карты нужна конвертация (см. `src/utils/geo.ts` — там же комментарий
с открытым вопросом про систему координат, нужно свериться с geometry.py,
но НЕ редактировать сам geometry.py — только читать для справки).

```
{
  "snapshot": {
    "t_s": 0,
    "satellites": [{ "id": "S01", "x_km": ..., "y_km": ..., "z_km": ..., "active": true }],
    "isl_links": [["S01", "S02", 1234.5]],
    "elevation_deg": { "<ground_site_id>": { "<sat_id>": 12.3 } },
    "visible_sats": { "<client_id>": ["S01", "S02"] }
  },
  "routes": [{ "client_id": "...", "path": [...] | null, "exists": true }],
  "visible_satellites_per_client": { "<client_id>": [...] }
}
```

### Analysis (`GET /api/analysis`)
```
{
  schema_version: "cosmo-A-result-1.0",
  effective_scenario: {...},
  analysis: {
    "<client_id>": {
      availability_pct, max_break_s, target_met,
      breaks: [{ start_s, end_s, duration_s, reason }],
      global_states: [...]
    }
  },
  routes: [...]
}
```

### ⚠️ Открытые вопросы (не проверены вживую, только через пересказ кода — сверить со Swagger/исходниками, не редактируя их):
- Точные строковые константы `reason` в outage-записях (кандидаты:
  `NO_VISIBLE_SATELLITE`/`NO_CLIENT_VISIBILITY`, `GATEWAY_UNAVAILABLE`,
  `NO_GATEWAY_CONNECTION`, `BROKEN_ISL_NETWORK` — не подтверждено построчным
  чтением router.py/analyzer.py).
- Точный состав полей `global_states` (сейчас в типах `Record<string, unknown>`).
- Структура `gateway_outages` (во всех 4 примерах сценариев массив пустой).
- Система координат в snapshot (ECI vs вращающаяся вместе с Землёй/ECEF-подобная) —
  критично для конвертации в lat/lon на 2D-карте.
- Точная структура `/api/auto-tune` ответа (best_configuration).

## Что уже сделано во фронтенде
- ESLint + Prettier настроены и работают (`npm run lint`, `npm run format`).
- Tailwind подключён через Vite-плагин.
- `.env.local`: `VITE_USE_MOCK=true`, `VITE_API_BASE_URL=http://localhost:8000`
  — переключение моки/реальный бэкенд одной переменной.
- Файлы в этой поставке (распаковать в `frontend/`, см. README_DELIVERY.md):
  - `src/types/scenario.ts` — Scenario, Environment, DesignPlane, DesignSatellite, GroundSite, Failure, GatewayOutage
  - `src/types/network-state.ts` — SnapshotResponse, Snapshot, SatelliteSnapshot, IslLinkTuple, RouteEntry
  - `src/types/analysis.ts` — AnalysisResult, ClientAnalysis, OutageBreak, RobustnessResult, CompareResult, AutoTuneResult
  - `src/utils/geo.ts` — cartesianToLatLon() (с пометкой о неподтверждённой системе координат)
  - `src/api/client.ts` — loadScenario, updateConfig, getSnapshot, saveVariant, compareVariants, getAnalysis, getRobustness, getAutoTune
  - `src/api/mock/fixtures.ts` — моки на основе реального data/01_full_constellation.json

## Что дальше по плану (п.7 ТЗ)
1. TanStack Query поверх api/client.ts (кэширование, loading/error состояния).
2. Роутинг/базовый layout (можно табами вместо полноценного роутера — экраны
   "Сценарный редактор" и "Симуляция/визуализация").
3. Сценарный редактор — формы над типами Scenario (react-hook-form + zod).
4. 2D-карта: наземные точки по lat_deg/lon_deg напрямую, спутники — через
   cartesianToLatLon(), ISL-линии, текущий маршрут.
5. Таймлайн — слайдер по t_s с шагом environment.step_s, запрос snapshot по времени.
6. Графики availability/outage (Plotly/Recharts) по данным /api/analysis,
   ключ — client_id.
7. Экспорт параметров/результатов.
