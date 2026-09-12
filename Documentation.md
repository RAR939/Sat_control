# Документация проекта «Маяк»

КосмоХакатон 2026. Веб-сервис проектирования и анализа спутниковой
группировки связи: расчёт покрытия наземных пунктов, маршрутизация до
наземного шлюза через сеть спутников, анализ устойчивости к отказам,
автоматический подбор конфигурации, сравнение вариантов.

Формат схемы сценария: `cosmo-A-1.0`.

---

## 1. Состав репозитория

```
backend/          FastAPI-сервис (Python)
frontend/          React SPA (TypeScript)
data/               примеры сценариев в формате cosmo-A-1.0
requirements.txt   зависимости бэкенда
run.sh              запуск бэкенда и фронтенда одной командой
```

## 2. Архитектура

Клиент-серверная схема с одним активным сценарием в оперативной памяти
бэкенда (не REST-ресурсы по id):

```
┌──────────────┐   HTTP/JSON   ┌───────────────────┐
│  Frontend    │ ─────────────▶│  Backend           │
│  (React SPA) │◀───────────── │  (FastAPI, uvicorn) │
└──────────────┘               └───────────────────┘
                                   current_scenario (dict, в памяти)
                                   saved_variants (dict[name -> dict])
```

Фронтенд может работать в двух режимах: против реального бэкенда по HTTP,
либо полностью автономно — с той же физикой, пересчитанной в браузере
(`VITE_USE_MOCK=true`, см. раздел 6.6).

## 3. Запуск

```bash
./run.sh          # backend (localhost:8000) + frontend (localhost:5173)
./run.sh --mock   # только frontend, без backend
```

Вручную:

```bash
cd backend && python3 -m venv venv && venv/bin/pip install -r ../requirements.txt
venv/bin/uvicorn main:app --port 8000

cd frontend && npm install && npm run dev
```

Переменные окружения фронтенда (`frontend/.env.local`):

| Переменная | Значение |
|---|---|
| `VITE_USE_MOCK` | `true` — расчёт в браузере, `false` — реальный бэкенд |
| `VITE_API_BASE_URL` | адрес бэкенда, по умолчанию `http://localhost:8000` |

Требования: Python 3.10+, Node.js 18+.

---

## 4. Модель данных: схема `cosmo-A-1.0`

### 4.1. Верхнеуровневая структура

```json
{
  "schema_version": "cosmo-A-1.0",
  "meta": { "id": "string", "title": "string" },
  "environment": { ... },
  "design": { ... },
  "ground_sites": [ ... ],
  "failures": [ ... ],
  "gateway_outages": [ ... ]
}
```

### 4.2. `environment`

| Поле | Тип | Диапазон | Назначение |
|---|---|---|---|
| `altitude_km` | float | 200–1200 | высота круговой орбиты |
| `inclination_deg` | float | (0, 180] | наклонение орбиты |
| `earth_angle0_deg` | float | конечное число | угол поворота Земли в момент t=0 |
| `horizon_s` | int | 0 < step_s ≤ horizon_s ≤ 172800, кратно step_s | горизонт расчёта, с |
| `step_s` | int | > 0 | шаг расчётной сетки, с |
| `min_elevation_deg` | float | [0, 90) | минимальный угол места для связи с Землёй |
| `isl_range_km` | float | (0, 10000] | предельная дальность межспутниковой линии |
| `target_availability` | float | [0, 1] | целевая доля времени с рабочим маршрутом |

### 4.3. `design`

| Поле | Тип | Назначение |
|---|---|---|
| `launch_stage` | 1 \| 2 \| 3 | текущая очередь запуска |
| `planes[]` | `{id, raan_deg, phase_deg}` | орбитальные плоскости; `raan_deg`/`phase_deg` ∈ [0, 360) |
| `satellites[]` | `{id, plane_id, slot_deg, launch_batch}` | спутники; `launch_batch` ∈ {1,2,3} |

Спутник активен, если `launch_batch <= launch_stage` и вне периода отказа.
Все `id` (спутники + наземные точки) уникальны в пределах сценария.

### 4.4. `ground_sites[]`

`{id, name, role, lat_deg, lon_deg}` — `role` ∈ {`client`, `gateway`};
`lat_deg` ∈ [-90, 90], `lon_deg` ∈ [-180, 180]. Сценарий обязан содержать
минимум одну точку каждой роли.

### 4.5. `failures[]` / `gateway_outages[]`

`{satellite_id | gateway_id, start_s, end_s}`, `0 ≤ start_s < end_s ≤ horizon_s`.
Начало интервала включается, конец исключается.

---

## 5. Бэкенд

### 5.1. Стек

FastAPI, Uvicorn, NumPy, Pydantic. Хранение состояния — в памяти процесса
(без базы данных): `current_scenario: dict`, `saved_variants: dict[str, dict]`.

### 5.2. Модули

| Файл | Ответственность |
|---|---|
| `main.py` | HTTP-роутинг, Pydantic-валидация тел запросов, глобальное состояние |
| `geometry.py` | координаты спутников, контакты, валидация сценария |
| `router.py` | построение и обновление маршрутов (BFS) |
| `analyzer.py` | полная симуляция по временной сетке, метрики доступности |
| `resilience.py` | анализ устойчивости (отказ спутников) |
| `optimization.py` | автоподбор RAAN/фазы плоскостей |
| `adapter.py` | преобразование результата `analyzer` в контракт `resilience`/`optimization` |

### 5.3. Расчёт координат (`geometry.py`)

Константы: `R = 6371` км (радиус Земли), `μ = 398600.435507` км³/с²
(гравитационный параметр), `T = 86164.09054` с (звёздные сутки).

Для спутника на плоскости с параметрами `raan_deg` (Ω), `phase_deg`,
`slot_deg`, при наклонении `inclination_deg` (i) и высоте `altitude_km` (h):

```
r = R + h
n = sqrt(μ / r³)                        угловая скорость обращения
u(t) = radians(slot_deg + phase_deg) + n·t

x = r·(cos Ω·cos u − sin Ω·sin u·cos i)
y = r·(sin Ω·cos u + cos Ω·sin u·cos i)
z = r·sin u·sin i                       координаты в орбитальной (инерциальной) системе
```

Переход в систему координат, вращающуюся вместе с Землёй:

```
θ = radians(earth_angle0_deg) + 2π·t/T
xₑ =  cos θ·x + sin θ·y
yₑ = −sin θ·x + cos θ·y
zₑ = z
```

`GET /api/snapshot/{t_s}` отдаёт координаты `(xₑ, yₑ, zₑ)` — то есть систему,
вращающуюся вместе с Землёй, а не инерциальную ECI. Наземные точки
рассчитываются в той же системе: `g = R·(cos φ·cos λ, cos φ·sin λ, sin φ)` без
зависимости от `t`.

**Контакт наземная точка ↔ спутник**: угол места
`el = degrees(arcsin(((s − g)·g) / (‖s − g‖·R)))` ≥ `min_elevation_deg` и
спутник активен; для шлюза дополнительно проверяется `gateway_outages`.

**Контакт спутник ↔ спутник (ISL)**: `‖b − a‖ < isl_range_km` и ближайшая к
центру Земли точка отрезка `[a; b]` лежит на расстоянии > `R` (проверка
незаслонённости Землёй): `d = b − a`, `q = clip(−a·d / (d·d), 0, 1)`,
ближайшая точка `a + q·d`.

### 5.4. Маршрутизация (`router.py`)

Алгоритм — BFS по графу контактов текущего снапшота (спутники + узел
клиента + узел шлюза), с приоритетом сохранения существующего маршрута:

1. Если у клиента уже был маршрут на предыдущем шаге, проверяется, что все
   его рёбра всё ещё существуют и все промежуточные узлы активны. Если да —
   маршрут не пересчитывается (`status = "OK"`).
2. Если нет — запускается BFS от клиента до шлюза через активные спутники.
   Найден новый маршрут → `status = "REBUILT"`.
3. Если маршрут не найден, причина определяется в этом порядке:
   - `"NO_VISIBLE_SATELLITE"` — у клиента нет ни одного видимого спутника;
   - `"GATEWAY_UNAVAILABLE"` — шлюз в `gateway_outages` на этот момент;
   - `"NO_GATEWAY_CONNECTION"` — ни один спутник геометрически не видит шлюз;
   - `"BROKEN_ISL_NETWORK"` — оба видят спутники, но между ними нет
     непрерывной цепочки ISL-связей.

Если в сценарии несколько точек с `role: "gateway"`, используется только
первая по порядку в `ground_sites` — мультишлюзовая маршрутизация не
реализована.

### 5.5. Полная симуляция (`analyzer.py`)

`run_full_simulation(scenario)` проходит по сетке `t = 0, step_s, 2·step_s,
..., horizon_s − step_s` и для каждого клиента считает:

- `availability_pct` — доля шагов с рабочим маршрутом, `%`;
- `max_break_s` — длительность самого долгого непрерывного разрыва связи, с
  (перерывы на границах горизонта учитываются);
- `target_met` — `availability_pct/100 >= target_availability`;
- `breaks[]` — список интервалов разрыва: `{start_s, end_s, duration_s, reason}`;
- `global_states[]` — состояние на каждом шаге:
  `{t_s, connected, path, active_satellites_count, status, snapshot_summary}`.

Результат: `{schema_version: "cosmo-A-result-1.0", effective_scenario, analysis, routes}`,
где `routes` — плоский список `{t_s, client_id, path}` по каждому шагу и
клиенту (в отличие от `snapshot.routes`, который является словарём).

### 5.6. Анализ устойчивости (`resilience.py`)

Для каждого активного спутника (или для сочетаний из `branch` спутников)
рассчитывается полная симуляция с искусственным отказом этого
спутника/группы на весь горизонт, затем сравнивается с базовым прогоном без
отказов. Критерий ранжирования — падение **минимальной** (не средней) по
клиентам доступности: `worst_case_drop = baseline_min − degraded_min`.
По умолчанию `branch = 1` (один спутник за раз); `branch ≥ 2` перебирает
комбинации через `itertools.combinations` — комбинаторно растущая стоимость.

### 5.7. Автоподбор конфигурации (`optimization.py`)

Подбор `raan_deg`/`phase_deg` для всех орбитальных плоскостей в два этапа:

1. Случайный поиск: `random_samples` конфигураций со случайными углами.
2. Локальное уточнение (покоординатный подъём) вокруг `top_k_to_refine`
   лучших конфигураций этапа 1: на каждой итерации перебираются соседи
   (один параметр одной плоскости, ±`step`), первое улучшение принимается,
   шаг уменьшается по `refine_steps`.

Критерий — максимизация минимальной по клиентам доступности (лексикографически:
при равенстве минимума сравнивается среднее). Полный перебор непрерывного
пространства параметров (по 2 угла на плоскость) не выполняется — по
6-мерному пространству это `O(∞)` вариантов.

### 5.8. API

| Метод | Путь | Тело / параметры | Описание |
|---|---|---|---|
| POST | `/api/load` | `{scenario_data: Scenario}` | загрузить сценарий как активный |
| POST | `/api/update-config` | `{launch_stage?, isl_range_km?, planes_update?, failures_update?}` | частично изменить активный сценарий |
| GET | `/api/snapshot/{t_s}` | — | состояние сети в момент `t_s` |
| POST | `/api/save-variant/{name}` | — | сохранить активный сценарий под именем |
| GET | `/api/compare/{name1}/{name2}` | — | сравнить два сохранённых варианта |
| GET | `/api/analysis` | — | полная симуляция активного сценария |
| GET | `/api/robustness` | `?branch=1` | рейтинг устойчивости |
| GET | `/api/auto-tune` | `?random_samples=10&seed=42` | автоподбор конфигурации |
| GET | `/api/export` | — | скачать анализ активного сценария (JSON-файл) |
| GET | `/api/export/variant/{name}` | — | скачать анализ сохранённого варианта |
| GET | `/api/export/compare/{name1}/{name2}` | — | скачать сравнение двух вариантов |

#### `GET /api/snapshot/{t_s}` — структура ответа

```json
{
  "snapshot": {
    "t_s": 0,
    "satellites": [{ "id": "S01", "x_km": 0, "y_km": 0, "z_km": 0, "active": true }],
    "edges": [["S01", "S02", 1234.5]],
    "elevation_deg": { "<ground_id>": { "<sat_id>": 12.3 } },
    "visible_sats": { "<client_id>": ["S01"] },
    "gateway_status": { "<gateway_id>": { "outage": false, "geometrically_reachable": true } }
  },
  "routes": { "<client_id>": ["<client_id>", "S01", "<gateway_id>"] },
  "visible_satellites_per_client": { "<client_id>": ["S01"] }
}
```

`edges` объединяет межспутниковые (ISL) и наземные линии видимости в одном
массиве троек `[node_a, node_b, distance_km]`.

#### `GET /api/analysis` — структура ответа

```json
{
  "schema_version": "cosmo-A-result-1.0",
  "effective_scenario": { "...": "полный Scenario" },
  "analysis": {
    "<client_id>": {
      "availability_pct": 97.3,
      "max_break_s": 720,
      "target_met": true,
      "breaks": [{ "start_s": 3600, "end_s": 4320, "duration_s": 720, "reason": "NO_VISIBLE_SATELLITE" }],
      "global_states": [{ "t_s": 0, "connected": true, "path": [], "active_satellites_count": 32, "status": "OK", "snapshot_summary": { "edges_count": 210, "visible_satellites": [] } }]
    }
  },
  "routes": [{ "t_s": 0, "client_id": "<client_id>", "path": [] }]
}
```

#### `GET /api/robustness` — структура ответа

```json
{
  "robustness_rating": [
    {
      "satellite_ids": ["S07"],
      "worst_case_availability_drop_pct": 12.3,
      "baseline_min_availability_pct": 90.0,
      "degraded_min_availability_pct": 77.7,
      "per_client_drop_pct": { "<client_id>": 12.3 },
      "causes_full_outage": false
    }
  ]
}
```

Отсортировано по убыванию `worst_case_availability_drop_pct`.

#### `GET /api/auto-tune` — структура ответа

```json
{
  "best_configuration": {
    "planes": { "<plane_id>": { "raan_deg": 0.0, "phase_deg": 0.0 } },
    "min_availability_pct": 92.1,
    "mean_availability_pct": 95.4,
    "per_client_availability_pct": { "<client_id>": 92.1 },
    "baseline_min_availability_pct": 88.0,
    "improvement_over_baseline_pct": 4.1,
    "evaluations_count": 47
  }
}
```

`planes` — словарь по id плоскости (не массив, как в `design.planes`).

### 5.9 Ограничения бэкенда

- Один активный сценарий и одна карта сохранённых вариантов на процесс —
  нет многопользовательской изоляции состояния.
- Один шлюз на маршрут (см. 5.4).
- `branch ≥ 2` в `/api/robustness` растёт комбинаторно —
  `C(N, branch)` полных симуляций.

---

## 6. Фронтенд

### 6.1. Стек

React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, Zustand,
react-globe.gl (three.js), Plotly.js, react-hook-form + zod.

### 6.2. Структура каталогов

```
frontend/src/
├── types/                     типы, зеркалирующие схему cosmo-A-1.0 и ответы API
│   ├── scenario.ts             Scenario, Environment, Design, GroundSite, Failure
│   ├── network-state.ts        Snapshot, SnapshotResponse, RoutesMap, EdgeTuple
│   └── analysis.ts             AnalysisResult, RouteStatus, RobustnessResult, AutoTuneResult
├── api/
│   ├── client.ts                HTTP-клиент + переключение мок/реальный режим
│   ├── hooks.ts                 TanStack Query хуки поверх client.ts
│   └── mock/
│       ├── engine.ts             реализация формул раздела 5.3–5.7 на TypeScript
│       └── fixtures.ts           список демонстрационных сценариев
├── stores/                     Zustand
│   ├── scenarioStore.ts          активный сценарий, имена сохранённых вариантов
│   ├── timelineStore.ts          t_s, состояние воспроизведения, скорость
│   └── uiStore.ts                активная вкладка, выбранный клиент
├── utils/
│   ├── geo.ts                    декартовы координаты → широта/долгота/высота
│   ├── pluralize.ts               склонение числительных (ru)
│   └── routeStatusLabels.ts       RouteStatus → отображаемый текст
├── components/
│   ├── Globe3D.tsx                3D-визуализация сети
│   ├── ObjectDetailsPanel.tsx      панель данных по выбранному объекту
│   ├── AvailabilityChart.tsx       графики доступности/связности
│   ├── Timeline.tsx                элемент управления временем
│   └── HudButton.tsx               кнопка (варианты primary/ghost/danger)
├── pages/
│   ├── EditorPage.tsx              загрузка сценария, редактирование конфигурации
│   └── SimulationPage.tsx          визуализация, графики, устойчивость, автоподбор
├── App.tsx                        шапка, переключение вкладок
└── main.tsx                       точка входа, `QueryClientProvider`
```

### 6.3. Типы данных

`src/types/*.ts` соответствуют разделу 5.8 один в один по именам полей
(snake_case, без переименования под camelCase) — сериализация запроса на
бэкенд не требует преобразования ключей.

### 6.4. Состояние приложения

| Стор | Поля | Обновляется |
|---|---|---|
| `scenarioStore` | `scenario: Scenario \| null`, `savedVariantNames: string[]` | побочный эффект `useLoadScenario`/`useUpdateConfig` (`api/hooks.ts`) |
| `timelineStore` | `t_s: number`, `playing: boolean`, `speed: number` | `Timeline.tsx` |
| `uiStore` | `activeTab: 'editor' \| 'simulation'`, `selectedClientId: string \| null` | `App.tsx`, `SimulationPage.tsx`, `Globe3D.tsx` |

Серверные данные (снапшот, анализ, устойчивость, автоподбор) не хранятся в
Zustand — они управляются TanStack Query (`api/hooks.ts`): кэш по ключам
`['snapshot', t_s]`, `['analysis']`, `['robustness', branch]`; при успешном
`load`/`update-config` кэш `snapshot`/`analysis`/`robustness` инвалидируется.

### 6.5. API-слой (`api/client.ts`)

Единственная точка вызова HTTP. Каждая функция (`loadScenario`,
`updateConfig`, `getSnapshot`, `saveVariant`, `compareVariants`,
`getAnalysis`, `getRobustness`, `getAutoTune`) проверяет флаг
`VITE_USE_MOCK` и либо выполняет `fetch` к `VITE_API_BASE_URL`, либо
вызывает соответствующую функцию `api/mock/engine.ts`. Компоненты и
страницы обращаются только к `api/hooks.ts`, не к `client.ts` напрямую.

Экспорт (`/api/export*`) реализован прямыми ссылками (`<a href>`) на
файловые эндпоинты бэкенда — недоступен в мок-режиме.

### 6.6. Мок-движок (`api/mock/engine.ts`)

Реализация формул раздела 5.3 (позиции спутников, контакты), 5.4
(BFS-маршрутизация с проверкой валидности) и 5.5 (полная симуляция) на
TypeScript — идентичные константы и порядок вычислений. Позволяет получить
`Snapshot`/`AnalysisResult`/`RobustnessResult`/`AutoTuneResult` без запущенного
бэкенда.

Состояние мок-режима (`MockState`) хранит `current: Scenario | null` и
`variants: Map<string, Scenario>` — та же модель «одно глобальное состояние
+ именованные варианты», что и `current_scenario`/`saved_variants` на
бэкенде (раздел 5.1).

Автоподбор (`mockAutoTune`) реализует тот же алгоритм, что 5.7, с меньшим
бюджетом прогонов (расчёт выполняется в главном потоке браузера) — числовой
результат отличается от `/api/auto-tune`, реализация алгоритма — нет.

### 6.7. `EditorPage.tsx`

- Загрузка сценария: выбор из `public/sample-scenarios/*.json` или
  произвольный файл (`<input type="file">`, парсинг с обрезкой ведущего
  UTF-8 BOM перед `JSON.parse`).
- Редактируемые поля (соответствуют телу `POST /api/update-config`):
  `launch_stage`, `isl_range_km`, `planes[].raan_deg`/`phase_deg`,
  `failures[]`. Валидация — `zod`-схема, применяется вручную в обработчике
  отправки формы.
- Сохранение именованного варианта (`POST /api/save-variant/{name}`) —
  элемент управления в той же форме, рядом с применением конфигурации.

### 6.8. `SimulationPage.tsx`

- `Timeline` — переход по `t_s`: слайдер, воспроизведение с множителем
  скорости (0.5×–20×), пошаговый переход на ±`step_s`.
- `Globe3D` + `ObjectDetailsPanel` — визуализация сети на момент `t_s` и
  панель данных по клику на объект.
- `AvailabilityChart` — доступность по клиентам и связность выбранного
  клиента во времени (`GET /api/analysis`).
- Блок устойчивости — таблица `GET /api/robustness`.
- Блок автоподбора — результат `GET /api/auto-tune`: изменение минимальной
  доступности, таблицы «до/после» по клиентам и по плоскостям, применение
  результата через `update-config`, выгрузка результата в JSON-файл
  (формируется на клиенте, без обращения к серверу).

### 6.9. `Globe3D.tsx`

| Слой react-globe.gl | Данные | Источник |
|---|---|---|
| `pointsData` | спутники (сфера, цвет по активности) | `snapshot.satellites`, координаты — `utils/geo.ts: cartesianToGeo` |
| `htmlElementsData` | подписи наземных точек, подпись спутника-релея выбранного клиента | `groundSites`, `routes`, `snapshot.visible_sats` |
| `arcsData` | ISL-линии, линии видимости земля-спутник, подсвеченный маршрут | `snapshot.edges`, `routes[selectedClientId]` |

Цвет маркера наземной точки: для `client` — зелёный при непустом
`routes[id]`, иначе красный; для `gateway` — красный при
`snapshot.gateway_status[id].outage`.

Взаимодействие: клик по спутнику (`onPointClick`) или по маркеру наземной
точки открывает `ObjectDetailsPanel`; клик по точке с `role: "client"`
дополнительно устанавливает её как выбранного клиента
(`uiStore.selectedClientId`). Выбор клиента из выпадающего списка на
странице центрирует камеру глобуса на его координатах
(`GlobeMethods.pointOfView`). Автовращение камеры отключается при первом
ручном взаимодействии с глобусом (`OrbitControls` событие `start`).

### 6.10. Визуальный стиль

Тёмная тема, статичный звёздный фон (`index.css`, SVG data-URI). Единственный
переиспользуемый интерактивный компонент — `HudButton` (`clip-path`
со срезанными углами, варианты `primary`/`ghost`/`danger`). Секции экранов —
`border-l-2` вместо рамки со всех сторон, `backdrop-blur-sm`.

---

## 7. Ограничения системы

- Мультишлюзовая маршрутизация не реализована (раздел 5.4).
- Экран сравнения сохранённых вариантов бок о бок отсутствует; `GET
  /api/compare/{name1}/{name2}` реализован в API-слое (`useCompareVariants`,
  `api/hooks.ts`), но не выведен в интерфейс.
- ISL-связи на глобусе отображаются дугами с автоматической высотой подъёма
  (`arcAltitudeAutoScale`), не точным отрезком прямой в 3D-пространстве.
- Автоматических тестов (unit/e2e) в репозитории нет; проверка типов —
  `tsc --noEmit` (см. `frontend/tsconfig.app.json`), статический анализ —
  ESLint (`frontend/eslint.config.js`).
- Состояние бэкенда — в памяти процесса, не переживает перезапуск.
