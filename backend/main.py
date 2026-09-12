from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List, Dict
import copy
import json
import re
from pathlib import Path
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

# Папка для постоянного хранения вариантов конфигураций
STORAGE_DIR = Path("saved_variants")
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

class ScenarioPayload(BaseModel):
    scenario_data: dict

class ConfigUpdate(BaseModel):
    launch_stage: Optional[int] = None
    isl_range_km: Optional[float] = None
    planes_update: Optional[List[Dict]] = None
    failures_update: Optional[List[Dict]] = None
    save_as: Optional[str] = None  # Имя для мгновенного сохранения варианта на диск

def _safe_filename(name: str) -> str:
    """Очищает имя файла от недопустимых символов."""
    return re.sub(r'[^A-Za-z0-9._-]', '_', name) or 'export'

def get_variant(name: str) -> dict:
    """Ищет вариант в памяти, а если сервер перезапускался — подгружает с диска."""
    if name in saved_variants:
        return saved_variants[name]
    
    file_path = STORAGE_DIR / f"{_safe_filename(name)}.json"
    if file_path.exists():
        data = json.loads(file_path.read_text(encoding="utf-8"))
        saved_variants[name] = data
        return data
        
    raise HTTPException(status_code=404, detail=f"Вариант '{name}' не найден ни в памяти, ни на диске")

def _download_json(data: dict, filename: str) -> Response:
    """Генерирует ответ с заголовками для скачивания файла браузером."""
    body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(filename)}"'},
    )

@app.post("/api/load", summary="Загрузка штатного сценария")
def api_load(payload: ScenarioPayload):
    global current_scenario
    try:
        validate(payload.scenario_data)
        current_scenario = payload.scenario_data
        return {"status": "success", "meta": current_scenario.get("meta")}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/update-config", summary="Изменение параметров конфигурации (и опциональное сохранение)")
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
        
        saved_info = None
        if cfg.save_as:
            safe_name = _safe_filename(cfg.save_as)
            saved_variants[cfg.save_as] = copy.deepcopy(current_scenario)
            file_path = STORAGE_DIR / f"{safe_name}.json"
            file_path.write_text(json.dumps(current_scenario, ensure_ascii=False, indent=2), encoding="utf-8")
            saved_info = {"variant": cfg.save_as, "file_path": str(file_path)}
            
        return {"status": "updated", "scenario": current_scenario, "saved": saved_info}
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

@app.get("/api/snapshot/step/{current_t_s}/{direction}", summary="Переход на соседний временной кадр (вперед/назад)")
def api_snapshot_step(current_t_s: int, direction: str):
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
        
    step = current_scenario['environment']['step_s']
    horizon = current_scenario['environment']['horizon_s']
    
    if direction == "next":
        new_t_s = current_t_s + step
    elif direction == "prev":
        new_t_s = current_t_s - step
    else:
        raise HTTPException(status_code=400, detail="Direction must be 'next' or 'prev'")
        
    # Защита от выхода за границы симуляции
    new_t_s = max(0, min(new_t_s, horizon))
    
    # Получаем стандартный снапшот и добавляем флаги границ для интерфейса
    result = api_snapshot(new_t_s)
    result["is_start"] = (new_t_s == 0)
    result["is_end"] = (new_t_s == horizon)
    
    return result

@app.post("/api/save-variant/{name}", summary="Сохранение варианта проекта на диск")
def api_save_variant(name: str):
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    
    safe_name = _safe_filename(name)
    saved_variants[name] = copy.deepcopy(current_scenario)
    
    # Физическая запись на жесткий диск
    file_path = STORAGE_DIR / f"{safe_name}.json"
    file_path.write_text(json.dumps(current_scenario, ensure_ascii=False, indent=2), encoding="utf-8")
    
    return {"status": "saved_to_disk", "variant": name, "file_path": str(file_path)}

@app.get("/api/compare/{name1}/{name2}", summary="Сравнение двух сохраненных вариантов")
def api_compare(name1: str, name2: str):
    v1 = get_variant(name1)
    v2 = get_variant(name2)
    
    res1 = run_full_simulation(v1)
    res2 = run_full_simulation(v2)
    diff = compare_scenarios(res1, res2)
    return {"variant_1": res1["analysis"], "variant_2": res2["analysis"], "comparison": diff}

@app.get("/api/analysis", summary="Полный расчет и анализ системы на всем временном отрезке")
def api_analysis():
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    return run_full_simulation(current_scenario)

@app.get("/api/robustness", summary="Доп. задача 5: Анализ устойчивости и рейтинг уязвимых спутников")
def api_robustness(branch: int = 1):
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

@app.get("/api/export", summary="Экспорт полного анализа текущего сценария (скачивание JSON)")
def api_export():
    if not current_scenario:
        raise HTTPException(status_code=400, detail="No scenario loaded")
    result = run_full_simulation(current_scenario)
    meta_id = current_scenario.get('meta', {}).get('id', 'scenario')
    return _download_json(result, f"analysis_{meta_id}.json")

@app.get("/api/export/variant/{name}", summary="Экспорт полного анализа сохранённого варианта (скачивание JSON)")
def api_export_variant(name: str):
    v = get_variant(name)
    result = run_full_simulation(v)
    return _download_json(result, f"analysis_variant_{name}.json")

@app.get("/api/export/compare/{name1}/{name2}", summary="Экспорт сравнения двух сохранённых вариантов (скачивание JSON)")
def api_export_compare(name1: str, name2: str):
    v1 = get_variant(name1)
    v2 = get_variant(name2)
    res1 = run_full_simulation(v1)
    res2 = run_full_simulation(v2)
    diff = compare_scenarios(res1, res2)
    payload = {"variant_1": res1["analysis"], "variant_2": res2["analysis"], "comparison": diff}
    return _download_json(payload, f"compare_{name1}_vs_{name2}.json")