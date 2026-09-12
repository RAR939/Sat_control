from __future__ import annotations
from geometry import snapshot
from router import compute_routes_for_snapshot

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
            status = rebuild_status.get(c, "NO_CLIENT_VISIBILITY")
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

def analyze_robustness(scenario: dict) -> list[dict]:
    base_res = run_full_simulation(scenario)
    base_avg_avail = sum(v["availability_pct"] for v in base_res["analysis"].values()) / len(base_res["analysis"])
    
    satellites = scenario['design']['satellites']
    vulnerability_rating = []
    
    for sat in satellites:
        sat_id = sat['id']
        failure_event = [{"satellite_id": sat_id, "start_s": 0, "end_s": scenario['environment']['horizon_s']}]
        
        sim_res = run_full_simulation(scenario, custom_failures=failure_event)
        sim_avg_avail = sum(v["availability_pct"] for v in sim_res["analysis"].values()) / len(sim_res["analysis"])
        
        impact = base_avg_avail - sim_avg_avail
        vulnerability_rating.append({
            "satellite_id": sat_id,
            "plane_id": sat['plane_id'],
            "availability_drop_pct": impact,
            "damaged_availability": sim_avg_avail
        })
        
    vulnerability_rating.sort(key=lambda x: x["availability_drop_pct"], reverse=True)
    return vulnerability_rating

def auto_tune_configuration(scenario: dict) -> dict:
    best_config = None
    best_score = -1.0
    
    for raan_offset in [0.0, 15.0, 30.0]:
        for phase_offset in [0.0, 7.5, 15.0]:
            test_scenario = copy_scenario(scenario)
            for idx, p in enumerate(test_scenario['design']['planes']):
                p['raan_deg'] = (p['raan_deg'] + raan_offset) % 360
                p['phase_deg'] = (p['phase_deg'] + phase_offset) % 360
                
            res = run_full_simulation(test_scenario)
            avg_avail = sum(v["availability_pct"] for v in res["analysis"].values()) / len(res["analysis"])
            
            if avg_avail > best_score:
                best_score = avg_avail
                best_config = {
                    "raan_offset_deg": raan_offset,
                    "phase_offset_deg": phase_offset,
                    "planes": test_scenario['design']['planes'],
                    "average_availability_pct": avg_avail
                }
                
    return best_config

def copy_scenario(scenario: dict) -> dict:
    import copy
    return copy.deepcopy(scenario)