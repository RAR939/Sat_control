"""
optimization.py — автоматический подбор конфигурации (пункт 6 плана).

Задача: подобрать RAAN и phase для каждой орбитальной плоскости так,
чтобы доступность связи была максимальной для ВСЕХ наземных клиентов
одновременно. Критерий — МИНИМАЛЬНАЯ доступность среди клиентов
(консистентно с resilience.py: нас интересует худший случай, а не
среднее — иначе можно "выиграть" за счёт одного хорошо покрытого
клиента и полностью потерять другой).

Почему нельзя просто перебрать всё: параметров много (raan_deg и
phase_deg на каждую плоскость — при 3 плоскостях это уже 6 непрерывных
переменных 0..360°), а оценка одной точки стоит целую полную симуляцию.
Полный grid search по 6 измерениям даже с грубым шагом 10° — это
36^6 ~ 2*10^9 точек, физически невозможно успеть.

Поэтому поиск сделан в два этапа:
  1. Случайный поиск (random search) по всему пространству — находит
     разные "бассейны" хорошего решения. Зависимость доступности от
     фазировки НЕ гладкая и НЕ выпуклая (спутники периодически "видят"
     и "не видят" наземную точку) — жадный спуск из одной случайной
     точки легко застревает в плохом локальном оптимуме.
  2. Локальное уточнение (coordinate hill-climbing) вокруг top-K лучших
     точек этапа 1 — меняем один параметр одной плоскости за раз, с
     уменьшающимся шагом (грубо -> точно), пока конфигурация улучшается.

Бюджет (число полных симуляций) известен заранее и ограничен явно.
"""

from __future__ import annotations

import copy
import random
from dataclasses import dataclass, field
from typing import Callable, Optional

from resilience import SimulationResult  # переиспользуем уже готовый контракт результата


PlaneConfig = dict  # {'raan_deg': float, 'phase_deg': float}
Configuration = dict  # {plane_id: PlaneConfig}


@dataclass
class EvaluatedConfiguration:
    """Одна оценённая конфигурация: сами параметры + метрики по клиентам."""

    configuration: Configuration
    min_availability: float  # худшая доступность среди клиентов -- основной критерий
    mean_availability: float  # средняя -- используется только как tie-break
    per_client_availability: dict

    @property
    def score(self) -> tuple:
        """Лексикографический критерий: сначала максимизируем худший случай,
        при равенстве -- среднее."""
        return (self.min_availability, self.mean_availability)


@dataclass
class OptimizationReport:
    """Все оценённые в ходе поиска конфигурации + исходная (baseline)."""

    evaluations: list = field(default_factory=list)
    baseline: Optional[EvaluatedConfiguration] = None

    def best(self) -> EvaluatedConfiguration:
        return max(self.evaluations, key=lambda ev: ev.score)

    def improvement_over_baseline(self) -> float:
        """На сколько выросла доступность худшего клиента по сравнению
        со штатной конфигурацией сценария (в долях, не в процентах)."""
        if self.baseline is None:
            raise ValueError("baseline не задан")
        return self.best().min_availability - self.baseline.min_availability


def _plane_ids(scenario: dict) -> list:
    return [p["id"] for p in scenario["design"]["planes"]]


def _current_configuration(scenario: dict) -> Configuration:
    return {
        p["id"]: {"raan_deg": p["raan_deg"], "phase_deg": p["phase_deg"]}
        for p in scenario["design"]["planes"]
    }


def apply_configuration(scenario: dict, config: Configuration) -> dict:
    """Возвращает ГЛУБОКУЮ КОПИЮ сценария с применённой конфигурацией.
    Углы приводятся по модулю 360 здесь же — так локальному уточнению
    не нужно самому следить за границами диапазона."""
    modified = copy.deepcopy(scenario)
    for plane in modified["design"]["planes"]:
        pid = plane["id"]
        if pid in config:
            plane["raan_deg"] = config[pid]["raan_deg"] % 360.0
            plane["phase_deg"] = config[pid]["phase_deg"] % 360.0
    return modified


def _evaluate(
    scenario: dict,
    config: Configuration,
    simulate_fn: Callable[[dict], SimulationResult],
) -> EvaluatedConfiguration:
    modified = apply_configuration(scenario, config)
    result = simulate_fn(modified)
    avail = {c.client_id: c.availability for c in result.clients}
    values = list(avail.values())
    return EvaluatedConfiguration(
        configuration=config,
        min_availability=min(values) if values else 0.0,
        mean_availability=sum(values) / len(values) if values else 0.0,
        per_client_availability=avail,
    )


def _random_configuration(plane_ids: list, rng: random.Random) -> Configuration:
    return {
        pid: {"raan_deg": rng.uniform(0, 360), "phase_deg": rng.uniform(0, 360)}
        for pid in plane_ids
    }


def _neighbors(config: Configuration, step_deg: float, plane_ids: list) -> list:
    """Соседние конфигурации: меняем ОДИН параметр ОДНОЙ плоскости на
    +-step_deg, остальное не трогаем (coordinate descent)."""
    neighbors = []
    for pid in plane_ids:
        for key in ("raan_deg", "phase_deg"):
            for sign in (1, -1):
                candidate = copy.deepcopy(config)
                candidate[pid][key] = candidate[pid][key] + sign * step_deg
                neighbors.append(candidate)
    return neighbors


def optimize_configuration(
    scenario: dict,
    simulate_fn: Callable[[dict], SimulationResult],
    random_samples: int = 20,
    refine_steps: tuple = (20.0, 5.0, 1.0),
    top_k_to_refine: int = 3,
    max_iterations_per_step: int = 30,
    seed: Optional[int] = None,
) -> OptimizationReport:
    """Подбирает RAAN/phase для всех плоскостей сценария.

    Оценка бюджета прогонов simulate_fn (важно замерить время ОДНОГО
    прогона перед запуском и прикинуть итог):
        1 (baseline) + random_samples
        + top_k_to_refine * len(refine_steps) * (до max_iterations_per_step
          итераций, каждая проверяет 4 * число_плоскостей соседей)

    Параметры:
        random_samples          — сколько случайных конфигураций пробуем
                                   на этапе глобального поиска.
        refine_steps             — шаги (в градусах) локального уточнения,
                                   от грубого к точному, по порядку.
        top_k_to_refine          — сколько лучших конфигураций (включая
                                   штатную) уточняем локально.
        max_iterations_per_step — защита от зависания: даже если
                                   локальный поиск продолжает находить
                                   улучшения, на одном шаге он остановится
                                   после этого числа итераций.
        seed                     — для воспроизводимости между запусками.
    """
    rng = random.Random(seed)
    plane_ids = _plane_ids(scenario)

    report = OptimizationReport()

    # Baseline — штатная конфигурация сценария, чтобы было с чем сравнивать.
    baseline_config = _current_configuration(scenario)
    report.baseline = _evaluate(scenario, baseline_config, simulate_fn)
    report.evaluations.append(report.baseline)

    # Этап 1: случайный поиск по всему пространству.
    for _ in range(random_samples):
        config = _random_configuration(plane_ids, rng)
        report.evaluations.append(_evaluate(scenario, config, simulate_fn))

    # Этап 2: локальное уточнение вокруг top-K лучших конфигураций
    # (включая baseline — вдруг штатная конфигурация уже неплоха).
    seed_configs = [
        ev.configuration
        for ev in sorted(report.evaluations, key=lambda e: e.score, reverse=True)[
            :top_k_to_refine
        ]
    ]

    for config in seed_configs:
        current = _evaluate(scenario, config, simulate_fn)
        for step in refine_steps:
            for _ in range(max_iterations_per_step):
                improved_this_round = False
                for neighbor in _neighbors(current.configuration, step, plane_ids):
                    candidate = _evaluate(scenario, neighbor, simulate_fn)
                    report.evaluations.append(candidate)
                    if candidate.score > current.score:
                        current = candidate
                        improved_this_round = True
                        break  # берём первое улучшение, не ищем лучшее среди соседей
                if not improved_this_round:
                    break  # на этом шаге больше не улучшается -- переходим к меньшему шагу

    return report
