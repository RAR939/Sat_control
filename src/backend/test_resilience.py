"""
test_resilience.py — проверка resilience.py на МОКЕ simulate_fn.

Мы ещё не ждём готовый simulate_fn от коллег (блоки 1-4) — здесь
подставлена упрощённая функция-заглушка, которая имитирует поведение
реальной симуляции: если в scenario['failures'] встречается конкретный
"критичный" спутник (S05), у клиента C2 availability резко падает.
Так можно проверить логику ранжирования уже сейчас, а после того как
появится настоящий simulate_fn — просто заменить мок на импорт реальной
функции, остальной код теста не меняется.
"""

from resilience import (
    ClientAvailability,
    SimulationResult,
    analyze_resilience,
)


def mock_simulate_fn(scenario: dict) -> SimulationResult:
    """Имитация полной симуляции. Правило:
    - если среди scenario['failures'] есть спутник 'S05' (отказавший на
      весь горизонт) -> у клиента C2 availability падает до 0.40 и
      max_outage становится большим;
    - если есть 'S12' -> у клиента C1 небольшое снижение (0.85);
    - иначе (baseline, без отказов) -> у всех клиентов 0.97-0.99.
    """
    failed_ids = {f["satellite_id"] for f in scenario["failures"]}

    c1_avail, c2_avail = 0.97, 0.99
    if "S05" in failed_ids:
        c2_avail = 0.40
    if "S12" in failed_ids:
        c1_avail = 0.85

    return SimulationResult(
        clients=[
            ClientAvailability(
                client_id="C1",
                availability=c1_avail,
                max_outage_s=1800 if c1_avail < 0.9 else 300,
                total_outage_s=3600 if c1_avail < 0.9 else 500,
            ),
            ClientAvailability(
                client_id="C2",
                availability=c2_avail,
                max_outage_s=20000 if c2_avail < 0.5 else 400,
                total_outage_s=40000 if c2_avail < 0.5 else 600,
            ),
        ]
    )


def mock_scenario() -> dict:
    """Минимальный сценарий, достаточный для _active_satellite_ids()
    и _with_failure() — реальные орбитальные поля geometry.py тут не нужны,
    потому что мок simulate_fn их не читает."""
    return {
        "environment": {"horizon_s": 86400},
        "design": {
            "launch_stage": 3,
            "satellites": [
                {"id": sid, "plane_id": "P1", "slot_deg": 0, "launch_batch": 1}
                for sid in ["S01", "S02", "S05", "S12", "S20"]
            ],
        },
        "failures": [],
    }


def main() -> None:
    scenario = mock_scenario()
    report = analyze_resilience(scenario, simulate_fn=mock_simulate_fn, branch=1)

    print(f"Всего прогонов (по одному спутнику): {len(report.impacts)}")
    print("Рейтинг критичности (от самого опасного отказа):")
    for impact in report.critical_satellites(top_n=5):
        print(
            f"  {impact.satellite_ids} -> "
            f"падение мин. доступности: {impact.worst_case_drop:.2f}, "
            f"полный обрыв связи: {impact.causes_full_outage}"
        )

    # Проверки, что логика ранжирования верна
    top = report.critical_satellites(top_n=1)[0]
    assert top.satellite_ids == ("S05",), "S05 должен быть самым критичным"
    assert top.causes_full_outage is False, "0.40 - это не полный обрыв (не 0.0)"
    assert top.worst_case_drop > 0.5, "падение по S05 должно быть заметным"

    print("\nВсе проверки пройдены.")


if __name__ == "__main__":
    main()
