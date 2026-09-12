from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List, Dict
import copy
import json
import re
from geometry import snapshot, validate, load
from router import compute_routes_for_snapshot
from analyzer import run_full_simulation, compare_scenarios, analyze_robustness, auto_tune_configuration

app = FastAPI(title="CosmoSats Advanced Production API", description="Бэкенд для проектирования устойчивой спутниковой группировки (КосмоХакатон 2026)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

current_scenario = {}
saved_variants = {}

class ScenarioPayload(BaseModel):
    scenario_data: dict

class ConfigUpdate(BaseModel):
    launch_stage: Optional[int] = None
    isl_range_km: Optional[float] = None
    planes_update: Optional[List[Dict]] = None
    failures_update: Optional[List[Dict]] = None

@app.post("/api/load", summary="Загрузка штатного сценария")
def api_load(payload: ScenarioPayload):
    global current_scenario
    try:
        validate(payload.scenario_data)
        current_scenario = payload.scenario_data
        return {"status": "success", "meta": current_scenario.get("meta")}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/update-config", summary="Изменение параметров конфигурации")
def api_update_config(cfg: ConfigUpdate):
    global current_scenario
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    
    backup = copy.deepcopy(current_scenario)
    
    try:
        if cfg.launch_stage is not None:
            current_scenario['design']['launch_stage'] = cfg.launch_stage
        if cfg.isl_range_km is not None:
            current_scenario['environment']['isl_range_km'] = cfg.isl_range_km
        if cfg.failures_update is not None:
            current_scenario['failures'] = cfg.failures_update
        if cfg.planes_update is not None:
            p_map = {p['id']: p for p in current_scenario['design']['planes']}
            for p_up in cfg.planes_update:
                pid = p_up.get('id')
                if pid in p_map:
                    if 'raan_deg' in p_up: 
                        p_map[pid]['raan_deg'] = float(p_up['raan_deg']) % 360.0
                    if 'phase_deg' in p_up: 
                        p_map[pid]['phase_deg'] = float(p_up['phase_deg']) % 360.0
                        
        validate(current_scenario)
        return {"status": "updated", "scenario": current_scenario}
    except Exception as e:
        current_scenario = backup
        raise HTTPException(status_code=400, detail=f"Ошибка валидации данных: {str(e)}")

@app.get("/api/snapshot/{t_s}", summary="Получение состояния сети в момент времени t_s")
def api_snapshot(t_s: int):
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    
    snap = snapshot(current_scenario, t_s)
    gateways = [g['id'] for g in current_scenario.get('ground_sites', []) if g['role'] == 'gateway']
    clients = [g['id'] for g in current_scenario.get('ground_sites', []) if g['role'] == 'client']
    active_sats = {s['id'] for s in snap['satellites'] if s['active']}
    
    routes = {}
    gw = gateways[0] if gateways else None
    if gw:
        routes, _ = compute_routes_for_snapshot(snap, clients, gw, active_sats)
        
    return {
        "snapshot": snap,
        "routes": routes,
        "visible_satellites_per_client": snap.get('visible_sats', {})
    }

@app.post("/api/save-variant/{name}", summary="Сохранение варианта проекта")
def api_save_variant(name: str):
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    saved_variants[name] = copy.deepcopy(current_scenario)
    return {"status": "saved", "variant": name}

@app.get("/api/compare/{name1}/{name2}", summary="Сравнение двух сохраненных вариантов")
def api_compare(name1: str, name2: str):
    if name1 not in saved_variants or name2 not in saved_variants:
        raise HTTPException(status_code=404, detail="One or both variants not found")
    
    res1 = run_full_simulation(saved_variants[name1])
    res2 = run_full_simulation(saved_variants[name2])
    diff = compare_scenarios(res1, res2)
    return {"variant_1": res1["analysis"], "variant_2": res2["analysis"], "comparison": diff}

@app.get("/api/analysis", summary="Полный расчет и анализ системы на всем временном отрезке")
def api_analysis():
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    return run_full_simulation(current_scenario)

@app.get("/api/robustness", summary="Доп. задача 5: Анализ устойчивости и рейтинг уязвимых спутников")
def api_robustness(branch: int = 1):
    """branch -- сколько спутников отказывает одновременно в одном прогоне
    (1 по умолчанию; branch>=2 переберёт комбинации и может быть медленным
    на большой группировке -- см. resilience.analyze_resilience)."""
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    rating = analyze_robustness(current_scenario, branch=branch)
    return {"robustness_rating": rating}

@app.get("/api/auto-tune", summary="Доп. задача 6: Автоподбор конфигурации")
def api_auto_tune(random_samples: int = 10, seed: int = 42):
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    best = auto_tune_configuration(current_scenario, random_samples=random_samples, seed=seed)
    return {"best_configuration": best}

def _safe_filename(name: str) -> str:
    """Убирает всё, кроме букв/цифр/._- , чтобы имя нельзя было использовать
    для path traversal или для инъекции лишних заголовков в Content-Disposition."""
    return re.sub(r'[^A-Za-z0-9._-]', '_', name) or 'export'

def _download_json(data: dict, filename: str) -> Response:
    """Отдаёт data как JSON-файл на скачивание (Content-Disposition: attachment)."""
    body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(filename)}"'},
    )

@app.get("/api/export", summary="Экспорт полного анализа текущего сценария (скачивание JSON)")
def api_export():
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    result = run_full_simulation(current_scenario)
    meta_id = current_scenario.get('meta', {}).get('id', 'scenario')
    return _download_json(result, f"analysis_{meta_id}.json")

@app.get("/api/export/variant/{name}", summary="Экспорт полного анализа сохранённого варианта (скачивание JSON)")
def api_export_variant(name: str):
    if name not in saved_variants:
        raise HTTPException(status_code=404, detail="Variant not found")
    result = run_full_simulation(saved_variants[name])
    return _download_json(result, f"analysis_variant_{name}.json")

@app.get("/api/export/compare/{name1}/{name2}", summary="Экспорт сравнения двух сохранённых вариантов (скачивание JSON)")
def api_export_compare(name1: str, name2: str):
    if name1 not in saved_variants or name2 not in saved_variants:
        raise HTTPException(status_code=404, detail="One or both variants not found")
    res1 = run_full_simulation(saved_variants[name1])
    res2 = run_full_simulation(saved_variants[name2])
    diff = compare_scenarios(res1, res2)
    payload = {"variant_1": res1["analysis"], "variant_2": res2["analysis"], "comparison": diff}
    return _download_json(payload, f"compare_{name1}_vs_{name2}.json")