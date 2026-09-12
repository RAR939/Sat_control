"""
resilience.py — модуль анализа устойчивости спутниковой группировки.

Идея (пункт 5 плана): для каждого (активного) спутника по очереди
"отключаем" его на весь горизонт расчёта и заново прогоняем полную
симуляцию (блоки 1-4). Сравниваем метрики с baseline (без искусственных
отказов) и получаем рейтинг спутников по тому, насколько их потеря
критична для клиентов.

Ключевое архитектурное решение: этот модуль НЕ знает, как устроена
симуляция изнутри. Он принимает функцию
    simulate_fn(scenario: dict) -> SimulationResult
как параметр (dependency injection). Это позволяет писать и
тестировать resilience независимо от деталей geometry.py/router.py/
analyzer.py — см. test_resilience.py, где simulate_fn замокан.

Ограничение по замыслу: тестируем отказ ОДНОГО спутника за раз
(branch=1) по умолчанию. Перебор пар/троек спутников комбинаторно
взрывается: при N=48 спутниках C(48,2)=1128 комбинаций,
C(48,3)=17296 — при полной симуляции каждой комбинации (сотни шагов x
BFS на шаг) это уже не мгновенно. Параметр branch оставлен
настраиваемым на случай, если времени достаточно, но по умолчанию 1.
"""

from __future__ import annotations

import copy
import itertools
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional


@dataclass
class ClientAvailability:
    """Метрики доступности для одной наземной точки-клиента за весь
    горизонт расчёта."""

    client_id: str
    availability: float  # доля времени с рабочим маршрутом, диапазон 0..1
    max_outage_s: float  # длительность самого длинного разрыва связи, сек
    total_outage_s: float  # суммарная длительность всех разрывов, сек


@dataclass
class SimulationResult:
    """Минимальный контракт результата полной симуляции сценария,
    нужный именно resilience-модулю."""

    clients: list[ClientAvailability]

    def availability_by_client(self) -> dict[str, float]:
        """Быстрый доступ: client_id -> availability, без max/total_outage."""
        return {c.client_id: c.availability for c in self.clients}


@dataclass
class SatelliteImpact:
    """Результат отказа одного (или нескольких, если branch > 1) спутников."""

    satellite_ids: tuple[str, ...]  # какие спутники "отключали" в этом прогоне
    baseline_min_availability: float  # худшая доступность среди клиентов ДО отказа
    degraded_min_availability: float  # худшая доступность среди клиентов ПОСЛЕ отказа
    per_client_drop: dict[str, float]  # client_id -> на сколько упала availability
    causes_full_outage: bool  # хотя бы у одного клиента availability стала 0.0

    @property
    def worst_case_drop(self) -> float:
        """Падение минимальной (по клиентам) доступности — основной критерий
        ранжирования. Берём минимум, а не среднее по клиентам умышленно:
        нас интересует худший случай, а не усреднённая картина, которая
        может маскировать один полностью отрезанный пункт."""
        return self.baseline_min_availability - self.degraded_min_availability


@dataclass
class ResilienceReport:
    """Итоговый отчёт со всеми прогонами; отдаёт отсортированный рейтинг."""

    branch: int
    impacts: list[SatelliteImpact] = field(default_factory=list)

    def ranking(self) -> list[SatelliteImpact]:
        """Рейтинг от самого критичного к наименее критичному прогону."""
        return sorted(self.impacts, key=lambda imp: imp.worst_case_drop, reverse=True)

    def critical_satellites(self, top_n: int = 5) -> list[SatelliteImpact]:
        """Топ-N самых уязвимых спутников/комбинаций — то, что идёт
        в сравнение конфигураций и в презентацию."""
        return self.ranking()[:top_n]


def _active_satellite_ids(scenario: dict) -> list[str]:
    """Спутники, которые вообще участвуют в текущей конфигурации
    (launch_batch <= launch_stage). Отказ ещё не запущенного спутника
    ничего не меняет по определению — не тратим на них время симуляции."""
    stage = scenario["design"]["launch_stage"]
    return [
        sat["id"]
        for sat in scenario["design"]["satellites"]
        if sat["launch_batch"] <= stage
    ]


def _with_failure(scenario: dict, satellite_ids: Iterable[str]) -> dict:
    """Возвращает ГЛУБОКУЮ КОПИЮ сценария с добавленными отказами указанных
    спутников на весь горизонт расчёта (start_s=0, end_s=horizon_s).

    Копия обязательно глубокая: simulate_fn может держать ссылки на
    вложенные списки/словари исходного сценария. Если мутировать оригинал
    напрямую, результаты последующих прогонов "потекут" друг в друга —
    это трудноуловимый баг, поэтому лучше не экономить на copy.deepcopy."""
    modified = copy.deepcopy(scenario)
    horizon = modified["environment"]["horizon_s"]
    for sid in satellite_ids:
        modified["failures"].append(
            {"satellite_id": sid, "start_s": 0, "end_s": horizon}
        )
    return modified


def analyze_resilience(
    scenario: dict,
    simulate_fn: Callable[[dict], SimulationResult],
    branch: int = 1,
    satellite_ids: Optional[list[str]] = None,
) -> ResilienceReport:
    """Прогоняет симуляцию с искусственными отказами и строит рейтинг
    самых уязвимых спутников.

    Параметры:
        scenario      — валидный сценарий (уже прошедший geometry.validate)
        simulate_fn   — функция полной симуляции: scenario -> SimulationResult.
        branch        — сколько спутников отказывает ОДНОВРЕМЕННО в одном
                        прогоне. По умолчанию 1 (одиночные отказы).
                        branch >= 2 включает перебор комбинаций через
                        itertools.combinations — ОБЯЗАТЕЛЬНО замерить время
                        на реальных данных перед использованием на большом
                        branch, чтобы не встрять по времени на защите.
        satellite_ids — если задано, тестируем отказы только среди этих
                        спутников (по умолчанию — все активные при текущем
                        launch_stage).

    Возвращает ResilienceReport со всеми прогонами; для итогового
    рейтинга используйте report.ranking() или report.critical_satellites().
    """
    if branch < 1:
        raise ValueError("branch must be >= 1")

    candidates = satellite_ids or _active_satellite_ids(scenario)

    # Baseline считается один раз — без искусственных отказов.
    baseline = simulate_fn(scenario)
    baseline_avail = baseline.availability_by_client()
    baseline_min = min(baseline_avail.values()) if baseline_avail else 1.0

    report = ResilienceReport(branch=branch)

    # itertools.combinations(candidates, branch): при branch=1 — это просто
    # "каждый спутник по одному", при branch=2 — все возможные пары и т.д.
    for combo in itertools.combinations(candidates, branch):
        degraded_scenario = _with_failure(scenario, combo)
        result = simulate_fn(degraded_scenario)
        degraded_avail = result.availability_by_client()

        per_client_drop = {
            client_id: baseline_avail.get(client_id, 0.0)
            - degraded_avail.get(client_id, 0.0)
            for client_id in baseline_avail
        }
        degraded_min = min(degraded_avail.values()) if degraded_avail else 0.0

        report.impacts.append(
            SatelliteImpact(
                satellite_ids=combo,
                baseline_min_availability=baseline_min,
                degraded_min_availability=degraded_min,
                per_client_drop=per_client_drop,
                causes_full_outage=(degraded_min == 0.0),
            )
        )

    return report
