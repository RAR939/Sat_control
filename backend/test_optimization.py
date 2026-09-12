"""
test_optimization.py — проверка optimize_configuration() на СИНТЕТИЧЕСКОЙ
целевой функции с заранее известным оптимумом.

Задаём "идеальную" конфигурацию (target raan/phase для каждой плоскости)
и mock-симуляцию, которая считает availability обратно пропорциональной
угловому расстоянию текущей конфигурации от идеальной (с учётом
цикличности углов -- 350° и 10° близки, а не далеки). Так проверяем,
что двухэтапный поиск реально находит область около оптимума.
"""

from optimization import optimize_configuration
from resilience import ClientAvailability, SimulationResult

TARGET = {
    "P1": {"raan_deg": 90.0, "phase_deg": 200.0},
    "P2": {"raan_deg": 270.0, "phase_deg": 10.0},
}

# 2 плоскости x 2 параметра x (180 градусов -- худшее угловое расстояние)^2
MAX_ERROR = 2 * 2 * (180.0 ** 2)


def angular_diff(a: float, b: float) -> float:
    """Кратчайшее угловое расстояние с учётом цикличности (350 и 10 -> 20, не 340)."""
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def mock_simulate_fn(scenario: dict) -> SimulationResult:
    planes = {p["id"]: p for p in scenario["design"]["planes"]}
    error = 0.0
    for pid, target in TARGET.items():
        error += angular_diff(planes[pid]["raan_deg"], target["raan_deg"]) ** 2
        error += angular_diff(planes[pid]["phase_deg"], target["phase_deg"]) ** 2
    availability = max(0.0, 1.0 - error / MAX_ERROR)
    return SimulationResult(
        clients=[
            ClientAvailability(
                client_id="C1",
                availability=availability,
                max_outage_s=0.0,
                total_outage_s=0.0,
            )
        ]
    )


def mock_scenario() -> dict:
    return {
        "design": {
            "planes": [
                {"id": "P1", "raan_deg": 0.0, "phase_deg": 0.0},
                {"id": "P2", "raan_deg": 0.0, "phase_deg": 0.0},
            ]
        }
    }


def main() -> None:
    scenario = mock_scenario()

    report = optimize_configuration(
        scenario,
        simulate_fn=mock_simulate_fn,
        random_samples=30,
        refine_steps=(30.0, 10.0, 3.0, 1.0),
        top_k_to_refine=3,
        seed=42,
    )

    baseline = report.baseline
    best = report.best()

    print(f"Всего оценённых конфигураций: {len(report.evaluations)}")
    print(f"Baseline (штатная конфигурация): min_availability={baseline.min_availability:.4f}")
    print(f"Лучшая найденная конфигурация:   min_availability={best.min_availability:.4f}")
    print(f"Найденные параметры: {best.configuration}")
    print(f"Целевые параметры:   {TARGET}")
    print(f"Улучшение над baseline: {report.improvement_over_baseline():+.4f}")

    assert report.improvement_over_baseline() > 0.2, "поиск должен заметно улучшить baseline"
    assert best.min_availability > 0.95, "лучшая конфигурация должна быть близко к оптимуму (>0.95)"

    for pid, target in TARGET.items():
        found = best.configuration[pid]
        raan_err = angular_diff(found["raan_deg"], target["raan_deg"])
        phase_err = angular_diff(found["phase_deg"], target["phase_deg"])
        print(f"  {pid}: ошибка RAAN={raan_err:.1f}°, ошибка phase={phase_err:.1f}°")
        assert raan_err < 15.0, f"{pid}: RAAN найден недостаточно точно"
        assert phase_err < 15.0, f"{pid}: phase найден недостаточно точно"

    print("\nВсе проверки пройдены — оптимизатор сошёлся к целевой конфигурации.")


if __name__ == "__main__":
    main()
