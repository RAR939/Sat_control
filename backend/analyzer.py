from __future__ import annotations
from geometry import snapshot
from router import compute_routes_for_snapshot
from resilience import analyze_resilience as _analyze_resilience
from optimization import optimize_configuration as _optimize_configuration
from adapter import to_simulation_result

def run_full_simulation(scenario: dict, override_isl: float | None = None, custom_failures: list | None = None) -> dict:
    env = scenario['environment']
    horizon = env['horizon_s']
    step = env['step_s']
    times = range(0, horizon, step)
    
    clients = [g['id'] for g in scenario.get('ground_sites', []) if g['role'] == 'client']
    gateways = [g['id'] for g in scenario.get('ground_sites', []) if g['role'] == 'gateway']
    gw = gateways[0] if gateways else None
    
    client_stats = {
        c: {
            "visible_count": 0, 
            "connected_count": 0, 
            "max_break_s": 0, 
            "current_break_s": 0, 
            "breaks_history": [],
            "global_states": []
        } for c in clients
    }
    
    all_routes_log = []
    prev_routes = {}
    
    current_break_start = {c: None for c in clients}
    current_break_reason = {c: None for c in clients}

    for t in times:
        snap = snapshot(scenario, t, override_isl_range=override_isl, custom_failures=custom_failures)
        active_sats = {s['id'] for s in snap['satellites'] if s['active']}
        
        routes = {}
        rebuild_status = {}
        if gw:
            routes, rebuild_status = compute_routes_for_snapshot(snap, clients, gw, active_sats, prev_routes)
            prev_routes = routes
            
        for c in clients:
            path = routes.get(c, [])
            status = rebuild_status.get(c, "NO_VISIBLE_SATELLITE")
            has_connection = len(path) > 0
            
            client_stats[c]["global_states"].append({
                "t_s": t,
                "connected": has_connection,
                "path": path,
                "active_satellites_count": len(active_sats),
                "status": status,
                "snapshot_summary": {
                    "edges_count": len(snap['edges']),
                    "visible_satellites": snap.get('visible_sats', {}).get(c, [])
                }
            })
            
            if has_connection:
                client_stats[c]["connected_count"] += 1
                if current_break_start[c] is not None:
                    break_duration = t - current_break_start[c]
                    client_stats[c]["breaks_history"].append({
                        "start_s": current_break_start[c],
                        "end_s": t,
                        "duration_s": break_duration,
                        "reason": current_break_reason[c]
                    })
                    if break_duration > client_stats[c]["max_break_s"]:
                        client_stats[c]["max_break_s"] = break_duration
                    current_break_start[c] = None
                    current_break_reason[c] = None
                client_stats[c]["current_break_s"] = 0
            else:
                client_stats[c]["current_break_s"] += step
                if current_break_start[c] is None:
                    current_break_start[c] = t
                    current_break_reason[c] = status

        for c, path in routes.items():
            all_routes_log.append({"t_s": t, "client_id": c, "path": path})

    total_steps = len(list(times))
    results = {}
    for c, stats in client_stats.items():
        if current_break_start[c] is not None:
            break_duration = horizon - current_break_start[c]
            stats["breaks_history"].append({
                "start_s": current_break_start[c],
                "end_s": horizon,
                "duration_s": break_duration,
                "reason": current_break_reason[c]
            })
            if break_duration > stats["max_break_s"]:
                stats["max_break_s"] = break_duration
                
        max_b = stats["max_break_s"]
        availability = (stats["connected_count"] / total_steps) if total_steps > 0 else 0
        results[c] = {
            "availability_pct": availability * 100,
            "max_break_s": max_b,
            "target_met": availability >= env['target_availability'],
            "breaks": stats["breaks_history"],
            "global_states": stats["global_states"]
        }
        
    return {
        "schema_version": "cosmo-A-result-1.0",
        "effective_scenario": scenario,
        "analysis": results,
        "routes": all_routes_log
    }

def compare_scenarios(res1: dict, res2: dict) -> dict:
    comparison = {}
    clients = res1["analysis"].keys()
    for c in clients:
        a1 = res1["analysis"][c]["availability_pct"]
        a2 = res2["analysis"][c]["availability_pct"]
        mb1 = res1["analysis"][c]["max_break_s"]
        mb2 = res2["analysis"][c]["max_break_s"]
        comparison[c] = {
            "availability_diff_pct": a2 - a1,
            "max_break_diff_s": mb2 - mb1,
            "scenario_1_avail": a1,
            "scenario_2_avail": a2
        }
    return comparison

def _simulate_fn(scenario: dict):
    """Адаптирует run_full_simulation под контракт SimulationResult,
    ожидаемый resilience.py/optimization.py (dependency injection)."""
    return to_simulation_result(run_full_simulation(scenario))


def analyze_robustness(scenario: dict, branch: int = 1) -> list[dict]:
    """Доп. задача 5: рейтинг критичности спутников через resilience.py.

    Ранжирует по падению МИНИМАЛЬНОЙ (не средней) доступности среди
    клиентов -- худший случай, а не усреднённая картина, которая может
    маскировать один полностью отрезанный пункт.

    branch=1 -- отказ одного спутника за раз (по умолчанию); branch>=2
    включает перебор комбинаций и может быть медленным -- см. docstring
    resilience.analyze_resilience.
    """
    report = _analyze_resilience(scenario, simulate_fn=_simulate_fn, branch=branch)
    return [
        {
            "satellite_ids": list(impact.satellite_ids),
            "worst_case_availability_drop_pct": impact.worst_case_drop * 100,
            "baseline_min_availability_pct": impact.baseline_min_availability * 100,
            "degraded_min_availability_pct": impact.degraded_min_availability * 100,
            "per_client_drop_pct": {k: v * 100 for k, v in impact.per_client_drop.items()},
            "causes_full_outage": impact.causes_full_outage,
        }
        for impact in report.ranking()
    ]


def auto_tune_configuration(
    scenario: dict,
    random_samples: int = 8,
    refine_steps: tuple = (15.0,),
    top_k_to_refine: int = 2,
    max_iterations_per_step: int = 6,
    seed: int | None = 42,
) -> dict:
    """Доп. задача 6: автоподбор RAAN/phase через optimization.py.

    Параметры поиска намеренно скромнее дефолтов optimization.py --
    там budget рассчитан на автономный офлайн-прогон, а здесь это
    синхронный HTTP-эндпоинт, который должен успеть ответить за разумное
    время во время демонстрации. Замерено на реальных данных (48
    спутников, полный горизонт): один прогон simulate_fn ~0.5с, так что
    держим суммарный бюджет в пределах десятков прогонов.
    """
    report = _optimize_configuration(
        scenario,
        simulate_fn=_simulate_fn,
        random_samples=random_samples,
        refine_steps=refine_steps,
        top_k_to_refine=top_k_to_refine,
        max_iterations_per_step=max_iterations_per_step,
        seed=seed,
    )
    best = report.best()
    return {
        "planes": best.configuration,
        "min_availability_pct": best.min_availability * 100,
        "mean_availability_pct": best.mean_availability * 100,
        "per_client_availability_pct": {k: v * 100 for k, v in best.per_client_availability.items()},
        "baseline_min_availability_pct": report.baseline.min_availability * 100,
        "improvement_over_baseline_pct": report.improvement_over_baseline() * 100,
        "evaluations_count": len(report.evaluations),
    }