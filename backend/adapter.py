"""
adapter.py — тонкий адаптер между результатом analyzer.run_full_simulation()
и контрактом SimulationResult, который ожидают resilience.py/optimization.py.

Нужен, потому что run_full_simulation() возвращает куда более подробную
структуру (снэпшоты, маршруты, статусы по шагам), чем требуется этим двум
модулям -- см. их докстринги про dependency injection.
"""

from __future__ import annotations

from resilience import ClientAvailability, SimulationResult


def to_simulation_result(sim_output: dict) -> SimulationResult:
    """run_full_simulation(scenario) -> SimulationResult."""
    clients = []
    for client_id, stats in sim_output["analysis"].items():
        total_outage_s = sum(b["duration_s"] for b in stats["breaks"])
        clients.append(
            ClientAvailability(
                client_id=client_id,
                availability=stats["availability_pct"] / 100.0,
                max_outage_s=float(stats["max_break_s"]),
                total_outage_s=float(total_outage_s),
            )
        )
    return SimulationResult(clients=clients)
